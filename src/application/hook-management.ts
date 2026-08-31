import type { CodexHookConfigStore, CodexSessionRepository, HookInstallationStatus, HookRelayInstaller, HookTrustGateway } from "./ports";
import type { Logger } from "@shared/logger";

export interface HookManagementService {
  inspect(): Promise<HookInstallationStatus>;
  install(): Promise<HookInstallationStatus>;
  uninstall(): Promise<HookInstallationStatus>;
}

export class CodexHookManagementService implements HookManagementService {
  constructor(
    private readonly configStore: CodexHookConfigStore,
    private readonly relayInstaller: HookRelayInstaller,
    private readonly trustGateway: HookTrustGateway,
    private readonly sessions: CodexSessionRepository,
    private readonly configPath: string,
    private readonly logger: Logger,
  ) {}

  async inspect(): Promise<HookInstallationStatus> {
    const config = await this.configStore.read();
    const relayInstalled = await this.relayInstaller.exists();
    const installed = relayInstalled && config.manifest !== null && hasOwnedHooks(config.raw, config.manifest.command);
    const knownSessions = await this.sessions.search({ limit: 200, offset: 0 });
    const cwds = [...new Set(knownSessions.map((session) => session.snapshot.cwd).filter(Boolean))];
    let trustStates = [] as Awaited<ReturnType<HookTrustGateway["inspect"]>>;
    let message: string | null = null;
    if (installed) {
      try {
        trustStates = await this.trustGateway.inspect(cwds);
        message = trustStates.some((state) => state.status !== "trusted" && state.status !== "managed")
          ? "请在 Codex 中打开 /hooks，检查并信任 Synapse Hook。"
          : trustStates.length === 0
            ? "Hook 已安装。请在新的 Codex 任务中打开 /hooks，确认并信任 Managed by Synapse。"
            : null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        message = `Hook 已安装，但暂时无法检查信任状态：${detail}。请在 Codex 中打开 /hooks 手动确认。`;
        this.logger.error("[synapse:hook]", "trust-inspection-failed", { message: detail, cwds });
      }
    } else if (relayInstalled || config.manifest !== null) {
      message = "Synapse Hook 安装不完整，请点击“修复安装”。";
    }
    this.logger.info("[synapse:hook]", "installation-status-inspected", {
      installed, relayInstalled, hasManifest: config.manifest !== null, knownCwdCount: cwds.length,
    });
    return {
      installed,
      relayPath: this.relayInstaller.relayPath,
      configPath: this.configPath,
      trustStates,
      message,
    };
  }

  async install(): Promise<HookInstallationStatus> {
    await this.relayInstaller.install();
    await this.configStore.mergeOwnedHooks({ command: this.relayInstaller.relayPath, statusMessage: "Managed by Synapse" });
    return this.inspect();
  }

  async uninstall(): Promise<HookInstallationStatus> {
    const config = await this.configStore.read();
    if (config.manifest) await this.configStore.removeOwnedHooks(config.manifest);
    await this.relayInstaller.uninstall();
    return this.inspect();
  }
}

const ownedEvents = ["SessionStart", "UserPromptSubmit", "Stop"] as const;

function hasOwnedHooks(raw: Record<string, unknown>, command: string): boolean {
  const hooks = asRecord(raw.hooks);
  return ownedEvents.every((eventName) => {
    const groups = hooks[eventName];
    return Array.isArray(groups) && groups.some((group) => {
      const handlers = asRecord(group).hooks;
      return Array.isArray(handlers) && handlers.some((handler) => {
        const configured = asRecord(handler).command;
        return configured === command || configured === quoteCommand(command);
      });
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function quoteCommand(path: string): string { return `'${path.replaceAll("'", `'\\''`)}'`; }
