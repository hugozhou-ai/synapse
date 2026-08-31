import type { CodexHookConfigStore, CodexSessionRepository, HookInstallationStatus, HookRelayInstaller, HookTrustGateway, SettingsRepository } from "./ports";
import { DomainError } from "@domain/shared";
import type { Logger } from "@shared/logger";

export interface HookManagementService {
  inspect(): Promise<HookInstallationStatus>;
  install(): Promise<HookInstallationStatus>;
  trust(): Promise<HookInstallationStatus>;
  uninstall(): Promise<HookInstallationStatus>;
  dismissOnboarding(): Promise<HookInstallationStatus>;
}

export class CodexHookManagementService implements HookManagementService {
  constructor(
    private readonly configStore: CodexHookConfigStore,
    private readonly relayInstaller: HookRelayInstaller,
    private readonly trustGateway: HookTrustGateway,
    private readonly sessions: CodexSessionRepository,
    private readonly configPath: string,
    private readonly logger: Logger,
    private readonly settings: SettingsRepository,
    private readonly defaultInspectionCwd: string,
  ) {}

  async inspect(): Promise<HookInstallationStatus> {
    const config = await this.configStore.read();
    const relayInstalled = await this.relayInstaller.exists();
    const installed = relayInstalled && config.manifest !== null && hasOwnedHooks(config.raw, config.manifest.command);
    const onboardingRequired = !installed && !(await this.settings.read()).hookSetupAcknowledged;
    const cwds = await this.inspectionCwds();
    let trustStates = [] as Awaited<ReturnType<HookTrustGateway["inspect"]>>;
    let message: string | null = null;
    if (installed) {
      try {
        trustStates = await this.trustGateway.inspect(cwds, this.relayInstaller.relayPath, this.configPath);
        message = trustStates.some((state) => state.status === "untrusted" || state.status === "modified")
          ? "Hook 已安装但尚未启用。请检查命令后点击“信任并启用”。"
          : trustStates.some((state) => state.status === "unknown") || trustStates.length === 0
            ? "Hook 已安装，但暂时无法确认信任状态。"
            : null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        message = `Hook 已安装，但暂时无法检查信任状态：${detail}。`;
        this.logger.error("[synapse:hook]", "trust-inspection-failed", { message: detail, cwds });
      }
    } else if (relayInstalled || config.manifest !== null) {
      message = "Synapse Hook 安装不完整，请点击“修复安装”。";
    }
    this.logger.info("[synapse:hook]", "installation-status-inspected", {
      installed, trusted: isTrusted(trustStates), onboardingRequired, relayInstalled, hasManifest: config.manifest !== null, inspectionCwdCount: cwds.length,
    });
    return {
      installed,
      trusted: installed && isTrusted(trustStates),
      onboardingRequired,
      relayPath: this.relayInstaller.relayPath,
      configPath: this.configPath,
      trustStates,
      message,
    };
  }

  async install(): Promise<HookInstallationStatus> {
    await this.relayInstaller.install();
    await this.configStore.mergeOwnedHooks({ command: this.relayInstaller.relayPath, statusMessage: "Managed by Synapse" });
    await this.acknowledgeOnboarding();
    return this.inspect();
  }

  async trust(): Promise<HookInstallationStatus> {
    const status = await this.inspect();
    if (!status.installed) throw new DomainError("HOOK_NOT_INSTALLED", "请先安装 Synapse Hook。");
    const cwds = await this.inspectionCwds();
    await this.trustGateway.trust(cwds, this.relayInstaller.relayPath, this.configPath);
    this.logger.info("[synapse:hook]", "hooks-trusted", { inspectionCwdCount: cwds.length });
    return this.inspect();
  }

  async uninstall(): Promise<HookInstallationStatus> {
    const config = await this.configStore.read();
    if (config.manifest) await this.configStore.removeOwnedHooks(config.manifest);
    await this.relayInstaller.uninstall();
    await this.acknowledgeOnboarding();
    return this.inspect();
  }

  async dismissOnboarding(): Promise<HookInstallationStatus> {
    await this.acknowledgeOnboarding();
    this.logger.info("[synapse:hook]", "setup-onboarding-dismissed", {});
    return this.inspect();
  }

  private async acknowledgeOnboarding(): Promise<void> {
    const current = await this.settings.read();
    if (!current.hookSetupAcknowledged) await this.settings.save({ ...current, hookSetupAcknowledged: true });
  }

  private async inspectionCwds(): Promise<readonly string[]> {
    const knownSessions = await this.sessions.search({ limit: 200, offset: 0 });
    const known = [...new Set(knownSessions.map((session) => session.snapshot.cwd).filter(Boolean))];
    return known.length > 0 ? known : [this.defaultInspectionCwd];
  }
}

function isTrusted(states: readonly { status: string }[]): boolean {
  return states.length > 0 && states.every((state) => state.status === "trusted" || state.status === "managed");
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
