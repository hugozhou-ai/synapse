import { join } from "node:path";
import type {
  AgentModel,
  AppServerRuntimeStatus,
  AppServerRuntimeStatusProvider,
  HookTrustGateway,
  HookTrustState,
  SummaryAgentActivity,
  SummaryAgentGateway,
  SummaryAgentRequest,
} from "@application/ports";
import type { GeneratedSummary } from "@domain/conversation";
import { DomainError } from "@domain/shared";
import type { Logger } from "@shared/logger";
import { StdioCodexAppServerClient, type CodexAppServerClient } from "./client";
import { AppServerHookTrustGateway, CodexAppServerSummaryAgentGateway } from "./gateways";
import { CodexBinaryResolver } from "./resolver";
import { CodexAppServerSupervisor } from "./supervisor";

interface ActiveAdapters {
  readonly client: CodexAppServerClient;
  readonly agent: CodexAppServerSummaryAgentGateway;
  readonly trust: AppServerHookTrustGateway;
}

export function appServerAgentRuntimeDirectory(supportDirectory: string): string {
  return join(supportDirectory, "agent-runtime");
}

export class LazyCodexAppServerRuntime implements
  SummaryAgentGateway,
  HookTrustGateway,
  AppServerRuntimeStatusProvider {
  private initialization: Promise<void> | null = null;
  private adapters: ActiveAdapters | null = null;
  private initializingClient: CodexAppServerClient | null = null;
  private closed = false;
  private status: AppServerRuntimeStatus = {
    state: "initializing",
    available: false,
    binaryPath: null,
    version: null,
    authentication: "unknown",
    error: null,
  };

  constructor(
    private readonly configuredPath: string | null,
    private readonly supportDirectory: string,
    private readonly logger: Logger,
  ) {}

  start(): void { void this.ensureInitialized(); }
  current(): Promise<AppServerRuntimeStatus> { return Promise.resolve(this.status); }

  async generate(request: SummaryAgentRequest, onActivity?: (activity: SummaryAgentActivity) => void): Promise<GeneratedSummary> {
    return (await this.requireAdapters()).agent.generate(request, onActivity);
  }

  async cancel(jobId: string): Promise<void> {
    const adapters = await this.availableAdapters();
    await adapters?.agent.cancel(jobId);
  }

  async listModels(): Promise<readonly AgentModel[]> {
    return (await this.requireAdapters()).agent.listModels();
  }

  async inspect(cwds: readonly string[], ownedCommand: string, ownedSourcePath: string): Promise<readonly HookTrustState[]> {
    this.start();
    const adapters = this.adapters;
    if (!adapters) return cwds.map((cwd) => ({ cwd, status: "unknown", hooks: [] }));
    return adapters.trust.inspect(cwds, ownedCommand, ownedSourcePath);
  }

  async trust(cwds: readonly string[], ownedCommand: string, ownedSourcePath: string): Promise<void> {
    return (await this.requireAdapters()).trust.trust(cwds, ownedCommand, ownedSourcePath);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.initializingClient?.close();
    await this.initialization?.catch(() => undefined);
    await this.adapters?.client.close();
    this.adapters = null;
  }

  private async availableAdapters(): Promise<ActiveAdapters | null> {
    await this.ensureInitialized();
    return this.adapters;
  }

  private async requireAdapters(): Promise<ActiveAdapters> {
    const adapters = await this.availableAdapters();
    if (!adapters) throw new DomainError("APP_SERVER_UNAVAILABLE", this.status.error ?? "Codex App Server 不可用，请在设置中检查 binary 与登录状态。");
    return adapters;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialization) this.initialization = this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<void> {
    try {
      const candidates = await new CodexBinaryResolver(this.logger).resolveCandidates(this.configuredPath);
      let lastError: unknown = null;
      for (const binary of candidates) {
        if (this.closed) return;
        const client = new CodexAppServerSupervisor(new StdioCodexAppServerClient(binary.path, this.logger), this.logger);
        this.initializingClient = client;
        try {
          await client.connect();
          await client.request("model/list", {});
          await client.request("hooks/list", { cwds: [] });
          const account = await client.request<{ account?: unknown; requiresOpenaiAuth?: boolean }>("account/read", { refreshToken: false });
          if (this.closed) { await client.close(); return; }
          const authentication = account.account ? "signed-in" : account.requiresOpenaiAuth ? "required" : "not-required";
          this.adapters = {
            client,
            agent: new CodexAppServerSummaryAgentGateway(client, appServerAgentRuntimeDirectory(this.supportDirectory)),
            trust: new AppServerHookTrustGateway(client),
          };
          this.initializingClient = null;
          this.status = { state: "available", available: true, binaryPath: binary.path, version: binary.version, authentication, error: null };
          return;
        } catch (error) {
          lastError = error;
          await client.close();
          if (this.initializingClient === client) this.initializingClient = null;
          this.logger.error("[synapse:app-server]", "binary-handshake-failed", { path: binary.path, message: error instanceof Error ? error.message : String(error) });
        }
      }
      throw lastError ?? new Error("No compatible Codex App Server binary found.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { state: "unavailable", available: false, binaryPath: null, version: null, authentication: "unknown", error: message };
      this.logger.error("[synapse:app-server]", "unavailable", { message });
    }
  }
}
