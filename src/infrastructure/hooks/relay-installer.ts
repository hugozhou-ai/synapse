import { access, chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { HookRelayInstaller } from "@application/ports";
import type { Logger } from "@shared/logger";

export class FileSystemHookRelayInstaller implements HookRelayInstaller {
  constructor(
    readonly relayPath: string,
    private readonly packagedRelayPath: string,
    private readonly logger: Logger,
  ) {}

  async install(): Promise<void> {
    await mkdir(dirname(this.relayPath), { recursive: true, mode: 0o700 });
    await copyFile(this.packagedRelayPath, this.relayPath);
    await chmod(this.relayPath, 0o700);
    this.logger.info("[synapse:hook]", "relay-installed", { relayPath: this.relayPath });
  }
  async uninstall(): Promise<void> { await rm(this.relayPath, { force: true }); }
  async exists(): Promise<boolean> { try { await access(this.relayPath); return true; } catch { return false; } }
}
