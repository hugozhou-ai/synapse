import { homedir } from "node:os";
import { join } from "node:path";
import type { App } from "electron";
import { CodexHookManagementService, type HookManagementService } from "@application/hook-management";
import { PersistentSettingsApplicationService, RepositoryProfileApplicationService, RepositorySessionQueryService, RepositorySummaryQueryService, SystemExportApplicationService, type ExportApplicationService, type ProfileApplicationService, type SessionQueryService, type SettingsApplicationService, type SummaryQueryService } from "@application/query-services";
import { HookBasedSessionAwarenessService, type SessionAwarenessService } from "@application/session-services";
import { OutboxSummaryPublicationService, ProfileDrivenSummaryGenerationService, VersionedSummaryFinalizationService, type SummaryFinalizationService, type SummaryGenerationService, type SummaryPublicationService } from "@application/summary-services";
import type { AgentModel, AppServerRuntimeStatus, HookTrustGateway, HookTrustState, SummaryAgentGateway, SummaryAgentRequest } from "@application/ports";
import type { GeneratedSummary } from "@domain/conversation";
import { ArbitraryTurnSelectionService, DefaultSessionLifecycleService, NormalizedTurnSummaryContextService } from "@domain/services";
import { DomainError } from "@domain/shared";
import { AppServerConversationGateway, AppServerHookTrustGateway, CodexAppServerSummaryAgentGateway } from "@infrastructure/app-server/gateways";
import { StdioCodexAppServerClient, type CodexAppServerClient } from "@infrastructure/app-server/client";
import { CodexProtocolMapper } from "@infrastructure/app-server/mapper";
import { CodexBinaryResolver, type ResolvedCodexBinary } from "@infrastructure/app-server/resolver";
import { CodexAppServerSupervisor } from "@infrastructure/app-server/supervisor";
import { ElectronExportGateway } from "@infrastructure/electron/export-gateway";
import { JsonCodexHookConfigStore } from "@infrastructure/hooks/config-store";
import { CodexHookProtocolMapper } from "@infrastructure/hooks/mapper";
import { UnixSocketHookEventReceiver, type HookEventReceiver } from "@infrastructure/hooks/receiver";
import { FileSystemHookRelayInstaller } from "@infrastructure/hooks/relay-installer";
import { FileSystemHookEventSpool } from "@infrastructure/hooks/spool";
import { NotesOutboxWorker } from "@infrastructure/notes/outbox-worker";
import { AppleNotesSummaryPublisher } from "@infrastructure/notes/publisher";
import { BetterSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteHookEventRepository, SqliteOutboxRepository, SqlitePublicationRepository, SqliteSettingsRepository, SqliteSummaryDocumentRepository, SqliteSummaryJobRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { BetterSqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { NodeContentHashService, SystemClock, UuidGenerator } from "@infrastructure/system";
import { JsonConsoleLogger, type Logger } from "@shared/logger";

export class ElectronApplicationContainer {
  readonly sessionAwareness!: SessionAwarenessService;
  readonly sessionQueries!: SessionQueryService;
  readonly summaryQueries!: SummaryQueryService;
  readonly summaryGeneration!: SummaryGenerationService;
  readonly summaryFinalization!: SummaryFinalizationService;
  readonly summaryPublication!: SummaryPublicationService;
  readonly profiles!: ProfileApplicationService;
  readonly settings!: SettingsApplicationService;
  readonly hookManagement!: HookManagementService;
  readonly exports!: ExportApplicationService;
  readonly hookReceiver!: HookEventReceiver;
  readonly notesWorker!: NotesOutboxWorker;
  readonly codexBinary!: ResolvedCodexBinary | null;

  private constructor(
    services: Omit<ElectronApplicationContainer, "close">,
    private readonly database: BetterSqliteSynapseDatabase,
    private readonly appServer: CodexAppServerClient | null,
  ) { Object.assign(this, services); }

  static async create(app: App, onSessionsChanged: () => void): Promise<ElectronApplicationContainer> {
    const logger = new JsonConsoleLogger(); const clock = new SystemClock(); const ids = new UuidGenerator();
    const supportDirectory = app.getPath("userData");
    const databasePath = join(supportDirectory, "synapse.sqlite3");
    const database = new BetterSqliteSynapseDatabase(databasePath, logger);
    const sessions = new SqliteCodexSessionRepository(database);
    const turns = new SqliteCodexTurnRepository(database);
    const hookEvents = new SqliteHookEventRepository(database);
    const profiles = new SqliteSummaryProfileRepository(database);
    const summaries = new SqliteSummaryDocumentRepository(database);
    const jobs = new SqliteSummaryJobRepository(database);
    const publications = new SqlitePublicationRepository(database);
    const outbox = new SqliteOutboxRepository(database);
    const settingsRepository = new SqliteSettingsRepository(database);
    const unitOfWork = new BetterSqliteUnitOfWork(database);

    const awareness = new HookBasedSessionAwarenessService(new DefaultSessionLifecycleService(), sessions, turns, hookEvents, outbox, unitOfWork, clock, ids);
    const settingsValue = await settingsRepository.read();
    const { binary, client, agent, trust, runtime } = await createAppServerAdapters(settingsValue.codexBinaryPath, supportDirectory, logger);
    const conversations = client ? new AppServerConversationGateway(client, new CodexProtocolMapper()) : new UnavailableConversationGateway();
    const summaryGeneration = new ProfileDrivenSummaryGenerationService(
      conversations, new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
      agent, profiles, summaries, sessions, jobs, unitOfWork, clock, ids,
    );
    const finalization = new VersionedSummaryFinalizationService(summaries, sessions, outbox, unitOfWork, clock, ids);
    const notesScript = resourcePath(app, "apple-notes-publisher.jxa");
    const publication = new OutboxSummaryPublicationService(summaries, publications, new AppleNotesSummaryPublisher(notesScript, logger), clock, outbox);

    const codexDirectory = process.env.CODEX_HOME || join(homedir(), ".codex");
    const configStore = new JsonCodexHookConfigStore(codexDirectory, supportDirectory, logger);
    const relayPath = join(supportDirectory, "bin", "codex-hook-relay.sh");
    const relay = new FileSystemHookRelayInstaller(relayPath, resourcePath(app, "codex-hook-relay.sh"), logger);
    const hookManagement = new CodexHookManagementService(configStore, relay, trust, sessions, configStore.hooksPath);
    const receiver = new UnixSocketHookEventReceiver(
      join(supportDirectory, "run", "hook.sock"), awareness, new CodexHookProtocolMapper(),
      new FileSystemHookEventSpool(join(supportDirectory, "spool")), logger, onSessionsChanged,
    );
    const notesWorker = new NotesOutboxWorker(outbox, publication, clock, logger);

    const services = {
      sessionAwareness: awareness,
      sessionQueries: new RepositorySessionQueryService(sessions, turns, clock, conversations),
      summaryQueries: new RepositorySummaryQueryService(summaries),
      summaryGeneration,
      summaryFinalization: finalization,
      summaryPublication: publication,
      profiles: new RepositoryProfileApplicationService(profiles, ids),
      settings: new PersistentSettingsApplicationService(settingsRepository, agent, runtime),
      hookManagement,
      exports: new SystemExportApplicationService(summaries, new ElectronExportGateway(databasePath)),
      hookReceiver: receiver,
      notesWorker,
      codexBinary: binary,
    };
    return new ElectronApplicationContainer(services as Omit<ElectronApplicationContainer, "close">, database, client);
  }

  async close(): Promise<void> {
    this.notesWorker.stop(); await this.hookReceiver.stop(); await this.appServer?.close(); this.database.close();
  }
}

async function createAppServerAdapters(configuredPath: string | null, supportDirectory: string, logger: Logger): Promise<{
  binary: ResolvedCodexBinary | null; client: CodexAppServerClient | null; agent: SummaryAgentGateway; trust: HookTrustGateway; runtime: AppServerRuntimeStatus;
}> {
  try {
    const candidates = await new CodexBinaryResolver(logger).resolveCandidates(configuredPath);
    let lastError: unknown = null;
    for (const binary of candidates) {
      const client = new CodexAppServerSupervisor(new StdioCodexAppServerClient(binary.path, logger), logger);
      try {
        await client.connect();
        await client.request("model/list", {});
        await client.request("hooks/list", { cwds: [] });
        const account = await client.request<{ account?: unknown; requiresOpenaiAuth?: boolean }>("account/read", { refreshToken: false });
        const authentication = account.account ? "signed-in" : account.requiresOpenaiAuth ? "required" : "not-required";
        return {
          binary, client,
          agent: new CodexAppServerSummaryAgentGateway(client, join(supportDirectory, "agent-runtime")),
          trust: new AppServerHookTrustGateway(client),
          runtime: { available: true, binaryPath: binary.path, version: binary.version, authentication, error: null },
        };
      } catch (error) {
        lastError = error; await client.close();
        logger.error("[synapse:app-server]", "binary-handshake-failed", { path: binary.path, message: error instanceof Error ? error.message : String(error) });
      }
    }
    throw lastError ?? new Error("No compatible Codex App Server binary found.");
  } catch (error) {
    logger.error("[synapse:app-server]", "unavailable", { message: error instanceof Error ? error.message : String(error) });
    return {
      binary: null, client: null, agent: new UnavailableSummaryAgentGateway(), trust: new UnknownHookTrustGateway(),
      runtime: { available: false, binaryPath: null, version: null, authentication: "unknown", error: error instanceof Error ? error.message : String(error) },
    };
  }
}

class UnavailableSummaryAgentGateway implements SummaryAgentGateway {
  generate(_request: SummaryAgentRequest): Promise<GeneratedSummary> { return Promise.reject(new DomainError("APP_SERVER_UNAVAILABLE", "Codex App Server 不可用，请在设置中检查 binary 与登录状态。")); }
  cancel(_jobId: string): Promise<void> { return Promise.resolve(); }
  listModels(): Promise<readonly AgentModel[]> { return Promise.resolve([]); }
}

class UnavailableConversationGateway {
  readConversation(_threadId: string): Promise<never> { return Promise.reject(new DomainError("APP_SERVER_UNAVAILABLE", "Codex App Server 不可用。")); }
  waitUntilTurnPersisted(_threadId: string, _turnId: string): Promise<never> { return this.readConversation(_threadId); }
}

class UnknownHookTrustGateway implements HookTrustGateway {
  inspect(cwds: readonly string[]): Promise<readonly HookTrustState[]> { return Promise.resolve(cwds.map((cwd) => ({ cwd, status: "unknown" as const }))); }
}

function resourcePath(app: App, fileName: string): string {
  return app.isPackaged ? join(process.resourcesPath, "resources", fileName) : join(app.getAppPath(), "resources", fileName);
}
