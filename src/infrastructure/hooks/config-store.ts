import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  CodexHookConfiguration, CodexHookConfigStore, HookInstallManifest, OwnedHookSpec,
} from "@application/ports";
import type { Logger } from "@shared/logger";

const eventSpecs = [
  { name: "SessionStart", matcher: "startup|resume" },
  { name: "UserPromptSubmit", matcher: null },
  { name: "Stop", matcher: null },
] as const;

interface HookHandler { type?: unknown; command?: unknown; statusMessage?: unknown; [key: string]: unknown; }
interface HookGroup { matcher?: unknown; hooks?: unknown; [key: string]: unknown; }

export class JsonCodexHookConfigStore implements CodexHookConfigStore {
  readonly hooksPath: string;
  readonly configPath: string;
  readonly manifestPath: string;

  constructor(
    private readonly codexDirectory: string,
    private readonly supportDirectory: string,
    private readonly logger: Logger,
  ) {
    this.hooksPath = join(codexDirectory, "hooks.json");
    this.configPath = join(codexDirectory, "config.toml");
    this.manifestPath = join(supportDirectory, "hook-install-manifest.json");
  }

  async read(): Promise<CodexHookConfiguration> {
    return { raw: await this.readHooks(), manifest: await this.readManifest() };
  }

  async mergeOwnedHooks(spec: OwnedHookSpec): Promise<HookInstallManifest> {
    await mkdir(this.codexDirectory, { recursive: true, mode: 0o700 });
    await mkdir(this.supportDirectory, { recursive: true, mode: 0o700 });
    const existingManifest = await this.readManifest();
    const root = await this.readHooks();
    const hooks = asRecord(root.hooks);
    const commands = [existingManifest?.command, spec.command].filter((value): value is string => Boolean(value));

    for (const event of eventSpecs) {
      const groups = Array.isArray(hooks[event.name]) ? hooks[event.name] as unknown[] : [];
      hooks[event.name] = removeOwnedHandlers(groups, commands);
      (hooks[event.name] as unknown[]).push({
        ...(event.matcher ? { matcher: event.matcher } : {}),
        hooks: [{ type: "command", command: quoteCommand(spec.command), timeout: 5, statusMessage: spec.statusMessage }],
      });
    }
    root.hooks = hooks;
    await this.backupIfPresent(this.hooksPath);
    await atomicWrite(this.hooksPath, `${JSON.stringify(root, null, 2)}\n`, 0o600);

    const featureChanged = await this.enableHooksFeature();
    const featureEnabledByInstaller = existingManifest?.featureEnabledByInstaller === true || featureChanged;
    const manifest: HookInstallManifest = { command: spec.command, featureEnabledByInstaller, installedAt: new Date().toISOString() };
    await atomicWrite(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
    this.logger.info("[synapse:hook]", "hooks-installed", { hooksPath: this.hooksPath, relayPath: spec.command });
    return manifest;
  }

  async removeOwnedHooks(manifest: HookInstallManifest): Promise<void> {
    const root = await this.readHooks();
    const hooks = asRecord(root.hooks);
    for (const event of eventSpecs) {
      const groups = Array.isArray(hooks[event.name]) ? hooks[event.name] as unknown[] : [];
      const cleaned = removeOwnedHandlers(groups, [manifest.command]);
      if (cleaned.length === 0) delete hooks[event.name]; else hooks[event.name] = cleaned;
    }
    root.hooks = hooks;
    if (Object.keys(hooks).length === 0 && Object.keys(root).length === 1) {
      await rm(this.hooksPath, { force: true });
    } else {
      await atomicWrite(this.hooksPath, `${JSON.stringify(root, null, 2)}\n`, 0o600);
    }
    if (manifest.featureEnabledByInstaller) await this.disableHooksFeature();
    await rm(this.manifestPath, { force: true });
    this.logger.info("[synapse:hook]", "hooks-uninstalled", { hooksPath: this.hooksPath, relayPath: manifest.command });
  }

  private async readHooks(): Promise<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(await readFile(this.hooksPath, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("hooks.json root must be an object");
      return value as Record<string, unknown>;
    } catch (error) {
      if (isNotFound(error)) return {};
      throw error;
    }
  }

  private async readManifest(): Promise<HookInstallManifest | null> {
    try { return JSON.parse(await readFile(this.manifestPath, "utf8")) as HookInstallManifest; }
    catch (error) { if (isNotFound(error)) return null; throw error; }
  }

  private async enableHooksFeature(): Promise<boolean> {
    let content = "";
    try { content = await readFile(this.configPath, "utf8"); } catch (error) { if (!isNotFound(error)) throw error; }
    const mutation = mutateTomlFeature(content, true);
    if (mutation.changed) {
      await this.backupIfPresent(this.configPath);
      await atomicWrite(this.configPath, mutation.content, 0o600);
    }
    return mutation.changed;
  }

  private async disableHooksFeature(): Promise<void> {
    let content: string;
    try { content = await readFile(this.configPath, "utf8"); } catch (error) { if (isNotFound(error)) return; throw error; }
    if (!isHooksFeatureEnabled(content)) return;
    const mutation = mutateTomlFeature(content, false);
    if (mutation.changed) await atomicWrite(this.configPath, mutation.content, 0o600);
  }

  private async backupIfPresent(path: string): Promise<void> {
    try {
      await stat(path);
      const stamp = new Date().toISOString().replaceAll(":", "-");
      await copyFile(path, join(this.supportDirectory, `${basename(path)}.${stamp}.bak`));
    } catch (error) { if (!isNotFound(error)) throw error; }
  }
}

function isHooksFeatureEnabled(content: string): boolean {
  const lines = content.split("\n");
  const sectionIndex = lines.findIndex((line) => line.trim() === "[features]");
  if (sectionIndex < 0) return false;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*\[/.test(line)) break;
    if (/^\s*hooks\s*=\s*true\s*(#.*)?$/.test(line)) return true;
    if (/^\s*hooks\s*=/.test(line)) return false;
  }
  return false;
}

function quoteCommand(path: string): string { return `'${path.replaceAll("'", `'\\''`)}'`; }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
}

function removeOwnedHandlers(groups: readonly unknown[], commands: readonly string[]): HookGroup[] {
  return groups.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [value as HookGroup];
    const group = { ...value as HookGroup };
    if (!Array.isArray(group.hooks)) return [group];
    const filtered = group.hooks.filter((hook) => {
      if (!hook || typeof hook !== "object" || Array.isArray(hook)) return true;
      const handler = hook as HookHandler;
      const rawCommand = String(handler.command ?? "");
      return !commands.some((command) => rawCommand === command || rawCommand === quoteCommand(command));
    });
    if (filtered.length === 0) return [];
    group.hooks = filtered;
    return [group];
  });
}

export function mutateTomlFeature(content: string, enabled: boolean): { content: string; changed: boolean } {
  const lines = content.split("\n");
  const sectionIndex = lines.findIndex((line) => line.trim() === "[features]");
  if (sectionIndex < 0) {
    if (!enabled) return { content, changed: false };
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n\n" : content.length > 0 ? "\n" : "";
    return { content: `${content}${prefix}[features]\nhooks = true\n`, changed: true };
  }
  let end = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index]!)) { end = index; break; }
  }
  const keyIndex = lines.slice(sectionIndex + 1, end).findIndex((line) => /^\s*hooks\s*=/.test(line));
  const absoluteIndex = keyIndex < 0 ? -1 : sectionIndex + 1 + keyIndex;
  if (enabled) {
    if (absoluteIndex >= 0 && /^\s*hooks\s*=\s*true\s*(#.*)?$/.test(lines[absoluteIndex]!)) return { content, changed: false };
    if (absoluteIndex >= 0) lines[absoluteIndex] = "hooks = true"; else lines.splice(end, 0, "hooks = true");
  } else {
    if (absoluteIndex < 0) return { content, changed: false };
    lines.splice(absoluteIndex, 1);
    const nextSectionIndex = lines.findIndex((line, index) => index > sectionIndex && /^\s*\[/.test(line));
    const remainingEnd = nextSectionIndex < 0 ? lines.length : nextSectionIndex;
    const meaningful = lines.slice(sectionIndex + 1, remainingEnd).some((line) => line.trim() && !line.trim().startsWith("#"));
    if (!meaningful) lines.splice(sectionIndex, 1);
  }
  const next = lines.join("\n");
  return { content: next, changed: next !== content };
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

function isNotFound(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
