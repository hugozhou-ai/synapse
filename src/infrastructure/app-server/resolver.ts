import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "@shared/logger";

const execFileAsync = promisify(execFile);

export interface ResolvedCodexBinary { readonly path: string; readonly version: string; }

export class CodexBinaryResolver {
  constructor(private readonly logger: Logger) {}

  async resolve(configuredPath: string | null): Promise<ResolvedCodexBinary> {
    return (await this.resolveCandidates(configuredPath))[0]!;
  }

  async resolveCandidates(configuredPath: string | null): Promise<readonly ResolvedCodexBinary[]> {
    const candidates = [
      configuredPath,
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex",
      await this.shellCodexPath(),
    ].filter((value): value is string => Boolean(value));
    const unique = [...new Set(candidates)];
    const valid: ResolvedCodexBinary[] = [];
    for (const path of unique) {
      try {
        await access(path);
        const { stdout, stderr } = await execFileAsync(path, ["--version"], { timeout: 5_000 });
        const version = `${stdout}${stderr}`.trim();
        if (version) valid.push({ path, version });
      } catch (error) {
        this.logger.error("[synapse:app-server]", "binary-candidate-invalid", { path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (valid.length === 0) throw new Error("找不到可用的 Codex binary，请在设置中指定路径。");
    const sorted = valid.sort((left, right) => compareVersions(right.version, left.version));
    if (!configuredPath) return sorted;
    const configured = sorted.find((item) => item.path === configuredPath);
    return configured ? [configured, ...sorted.filter((item) => item.path !== configuredPath)] : sorted;
  }

  private async shellCodexPath(): Promise<string | null> {
    try { const { stdout } = await execFileAsync("/bin/zsh", ["-lic", "command -v codex"], { timeout: 5_000 }); return stdout.trim() || null; }
    catch { return null; }
  }
}

function compareVersions(left: string, right: string): number {
  const numbers = (value: string) => (value.match(/\d+/g) ?? []).map(Number);
  const a = numbers(left); const b = numbers(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference) return difference;
  }
  return 0;
}
