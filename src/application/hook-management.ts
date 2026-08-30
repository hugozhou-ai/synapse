import type { CodexHookConfigStore, CodexSessionRepository, HookInstallationStatus, HookRelayInstaller, HookTrustGateway } from "./ports";

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
  ) {}

  async inspect(): Promise<HookInstallationStatus> {
    const config = await this.configStore.read();
    const installed = await this.relayInstaller.exists();
    const knownSessions = await this.sessions.search({ limit: 200, offset: 0 });
    const cwds = [...new Set(knownSessions.map((session) => session.snapshot.cwd).filter(Boolean))];
    const trustStates = installed ? await this.trustGateway.inspect(cwds) : [];
    return {
      installed: installed && config.manifest !== null,
      relayPath: this.relayInstaller.relayPath,
      configPath: this.configPath,
      trustStates,
      message: trustStates.some((state) => state.status === "untrusted" || state.status === "modified")
        ? "请在 Codex 中打开 /hooks，检查并信任 Synapse Hook。"
        : null,
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
