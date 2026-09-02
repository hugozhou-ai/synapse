import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { CodexPluginInstallationStatus, CodexPluginManagement } from "@application/ports";
import { DomainError } from "@domain/shared";
import type { Logger } from "@shared/logger";
import { CodexBinaryResolver } from "@infrastructure/app-server/resolver";

const execFileAsync = promisify(execFile);
const PLUGIN_NAME = "synapse-reference";
const MARKETPLACE_NAME = "personal";

interface PluginManifest { name: string; version: string; author?: { name?: string }; [key: string]: unknown; }
interface MarketplacePlugin { name?: unknown; source?: { source?: unknown; path?: unknown }; [key: string]: unknown; }
interface MarketplaceRoot { name?: unknown; interface?: unknown; plugins?: unknown; [key: string]: unknown; }
interface PluginList { installed?: Array<{ pluginId?: unknown; version?: unknown; installed?: unknown; enabled?: unknown }>; }

export class FileSystemCodexPluginManagement implements CodexPluginManagement {
  readonly pluginPath: string;
  readonly marketplacePath: string;

  constructor(
    private readonly bundledPluginPath: string,
    userHome: string,
    private readonly configuredCodexPath: string | null,
    private readonly logger: Logger,
  ) {
    this.pluginPath = join(userHome, "plugins", PLUGIN_NAME);
    this.marketplacePath = join(userHome, ".agents", "plugins", "marketplace.json");
  }

  async inspect(): Promise<CodexPluginInstallationStatus> {
    const bundledVersion = await this.bundledVersion();
    try {
      const binary = await new CodexBinaryResolver(this.logger).resolve(this.configuredCodexPath);
      const { stdout } = await execFileAsync(binary.path, ["plugin", "list", "--json"], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as PluginList;
      const installed = parsed.installed?.find((item) => item.pluginId === `${PLUGIN_NAME}@${MARKETPLACE_NAME}` && item.installed === true && item.enabled === true);
      const installedVersion = typeof installed?.version === "string" ? installed.version : null;
      return this.status(bundledVersion, installedVersion, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("[synapse:plugin]", "inspection-failed", { message });
      return this.status(bundledVersion, null, `无法检查 Codex 插件：${message}`);
    }
  }

  async install(): Promise<CodexPluginInstallationStatus> {
    const sourceManifest = await this.readManifest(this.bundledPluginPath);
    const bundledVersion = await this.bundledVersion(sourceManifest);
    await this.assertDestinationOwned();
    const marketplace = await this.prepareMarketplace();
    const binary = await new CodexBinaryResolver(this.logger).resolve(this.configuredCodexPath);
    await this.installSource(sourceManifest, bundledVersion);
    await this.writeMarketplace(marketplace);
    try {
      await execFileAsync(binary.path, ["plugin", "add", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`, "--json"], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("[synapse:plugin]", "installation-failed", { message, pluginPath: this.pluginPath, marketplacePath: this.marketplacePath });
      throw new DomainError("PLUGIN_INSTALL_FAILED", `Codex 插件安装失败：${message}`);
    }
    const verification = await this.inspect();
    if (!verification.current) throw new DomainError("PLUGIN_INSTALL_FAILED", verification.message ?? "Codex 未加载刚安装的引用插件版本。");
    this.logger.info("[synapse:plugin]", "installed", { version: bundledVersion, pluginPath: this.pluginPath, marketplacePath: this.marketplacePath });
    return this.status(bundledVersion, bundledVersion, "插件已安装；请新建 Codex 任务后使用引用。");
  }

  private status(bundledVersion: string, installedVersion: string | null, message: string | null): CodexPluginInstallationStatus {
    return {
      installed: installedVersion !== null,
      current: installedVersion === bundledVersion,
      bundledVersion,
      installedVersion,
      pluginPath: this.pluginPath,
      marketplacePath: this.marketplacePath,
      message,
    };
  }

  private async bundledVersion(manifest?: PluginManifest): Promise<string> {
    const source = manifest ?? await this.readManifest(this.bundledPluginPath);
    const base = source.version.split("+")[0]!;
    const hash = createHash("sha256");
    for (const path of await listFiles(this.bundledPluginPath)) {
      hash.update(relative(this.bundledPluginPath, path));
      hash.update(await readFile(path));
    }
    return `${base}+codex.${hash.digest("hex").slice(0, 12)}`;
  }

  private async assertDestinationOwned(): Promise<void> {
    try {
      const manifest = await this.readManifest(this.pluginPath);
      if (manifest.name !== PLUGIN_NAME || manifest.author?.name !== "Synapse Contributors") {
        throw new DomainError("PLUGIN_PATH_CONFLICT", `${this.pluginPath} 已被其他插件占用，未覆盖。`);
      }
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  private async installSource(sourceManifest: PluginManifest, version: string): Promise<void> {
    await mkdir(dirname(this.pluginPath), { recursive: true, mode: 0o700 });
    const staging = `${this.pluginPath}.installing-${process.pid}-${Date.now()}`;
    await cp(this.bundledPluginPath, staging, { recursive: true, errorOnExist: true });
    await atomicWrite(join(staging, ".codex-plugin", "plugin.json"), `${JSON.stringify({ ...sourceManifest, version }, null, 2)}\n`, 0o600);
    await chmod(join(staging, "bin", "synapse-reference-mcp"), 0o755);
    const backup = `${this.pluginPath}.previous-${Date.now()}`;
    let hadExisting = false;
    try { await stat(this.pluginPath); hadExisting = true; await rename(this.pluginPath, backup); } catch (error) { if (!isNotFound(error)) throw error; }
    try {
      await rename(staging, this.pluginPath);
      if (hadExisting) await rm(backup, { recursive: true, force: true });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (hadExisting) await rename(backup, this.pluginPath);
      throw error;
    }
  }

  private async prepareMarketplace(): Promise<MarketplaceRoot> {
    const root = await this.readMarketplace();
    if (root.name !== undefined && root.name !== MARKETPLACE_NAME) {
      throw new DomainError("MARKETPLACE_CONFLICT", `个人 marketplace 名称为 ${String(root.name)}，无法安全安装 ${PLUGIN_NAME}。`);
    }
    const plugins = Array.isArray(root.plugins) ? root.plugins as MarketplacePlugin[] : [];
    const existingIndex = plugins.findIndex((plugin) => plugin.name === PLUGIN_NAME);
    const entry: MarketplacePlugin = {
      name: PLUGIN_NAME,
      source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    };
    if (existingIndex >= 0) {
      const existing = plugins[existingIndex]!;
      if (existing.source?.source !== "local" || existing.source.path !== `./plugins/${PLUGIN_NAME}`) {
        throw new DomainError("PLUGIN_MARKETPLACE_CONFLICT", "个人 marketplace 已有同名但来源不同的插件，未覆盖。");
      }
      plugins[existingIndex] = { ...existing, ...entry };
    } else plugins.push(entry);
    return {
      ...root,
      name: MARKETPLACE_NAME,
      interface: isRecord(root.interface) ? { ...root.interface, displayName: typeof root.interface.displayName === "string" ? root.interface.displayName : "Personal" } : { displayName: "Personal" },
      plugins,
    };
  }

  private async writeMarketplace(updated: MarketplaceRoot): Promise<void> {
    await mkdir(dirname(this.marketplacePath), { recursive: true, mode: 0o700 });
    await backupIfPresent(this.marketplacePath);
    await atomicWrite(this.marketplacePath, `${JSON.stringify(updated, null, 2)}\n`, 0o600);
  }

  private async readMarketplace(): Promise<MarketplaceRoot> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.marketplacePath, "utf8"));
      if (!isRecord(parsed)) throw new Error("marketplace.json root must be an object");
      return parsed;
    } catch (error) { if (isNotFound(error)) return {}; throw error; }
  }

  private async readManifest(root: string): Promise<PluginManifest> {
    const parsed: unknown = JSON.parse(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"));
    if (!isRecord(parsed) || parsed.name !== PLUGIN_NAME || typeof parsed.version !== "string") throw new Error(`Invalid ${PLUGIN_NAME} manifest.`);
    return parsed as PluginManifest;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path)); else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, content, { mode });
  await rename(temporary, path);
}

async function backupIfPresent(path: string): Promise<void> {
  try { await stat(path); await cp(path, `${path}.${new Date().toISOString().replaceAll(":", "-")}.bak`); }
  catch (error) { if (!isNotFound(error)) throw error; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isNotFound(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
