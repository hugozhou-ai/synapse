import { homedir } from "node:os";
import { join } from "node:path";
import type { App } from "electron";
import { CodexHookManagementService, type HookManagementService } from "@application/hook-management";
import { PersistentSettingsApplicationService, RepositoryProfileApplicationService, RepositorySessionQueryService, RepositorySummaryQueryService, SystemExportApplicationService, type ExportApplicationService, type ProfileApplicationService, type SessionQueryService, type SettingsApplicationService, type SummaryQueryService } from "@application/query-services";
import { HookBasedSessionAwarenessService, type SessionAwarenessService } from "@application/session-services";
import { DestinationAwareSummaryGenerationService, OutboxSummaryPublicationService, TransactionalSummaryDeletionService, VersionedSummaryFinalizationService, type SummaryDeletionService, type SummaryFinalizationService, type SummaryGenerationService, type SummaryPublicationService } from "@application/summary-services";
import { ArbitraryTurnSelectionService, DefaultSessionLifecycleService, NormalizedTurnSummaryContextService } from "@domain/services";
import { appServerAgentRuntimeDirectory, LazyCodexAppServerRuntime } from "@infrastructure/app-server/runtime";
import { ElectronExportGateway } from "@infrastructure/electron/export-gateway";
import { ElectronTextClipboardGateway } from "@infrastructure/electron/clipboard-gateway";
import { JsonCodexHookConfigStore } from "@infrastructure/hooks/config-store";
import { CodexHookProtocolMapper } from "@infrastructure/hooks/mapper";
import { UnixSocketHookEventReceiver, type HookEventReceiver } from "@infrastructure/hooks/receiver";
import { FileSystemHookRelayInstaller } from "@infrastructure/hooks/relay-installer";
import { FileSystemHookEventSpool } from "@infrastructure/hooks/spool";
import { JsonFileLogger } from "@infrastructure/logging/json-file-logger";
import { NotesOutboxWorker } from "@infrastructure/notes/outbox-worker";
import { AppleNotesSummaryPublisher } from "@infrastructure/notes/publisher";
import { NodeSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteHookEventRepository, SqliteOutboxRepository, SqlitePublicationRepository, SqliteSettingsRepository, SqliteSummaryDocumentRepository, SqliteSummaryJobRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { SqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { NodeContentHashService, SystemClock, UuidGenerator } from "@infrastructure/system";
import { CompositeLogger, JsonConsoleLogger, type Logger } from "@shared/logger";
import { RepositorySummaryReferenceService, type SummaryReferenceService } from "@application/summary-reference";
import { FileSystemCodexPluginManagement } from "@infrastructure/plugins/codex-plugin-management";
import type { CodexPluginManagement } from "@application/ports";

export class ElectronApplicationContainer {
  readonly sessionAwareness!: SessionAwarenessService;
  readonly sessionQueries!: SessionQueryService;
  readonly summaryQueries!: SummaryQueryService;
  readonly summaryGeneration!: SummaryGenerationService;
  readonly summaryDeletion!: SummaryDeletionService;
  readonly summaryFinalization!: SummaryFinalizationService;
  readonly summaryPublication!: SummaryPublicationService;
  readonly profiles!: ProfileApplicationService;
  readonly settings!: SettingsApplicationService;
  readonly hookManagement!: HookManagementService;
  readonly exports!: ExportApplicationService;
  readonly summaryReferences!: SummaryReferenceService;
  readonly codexPlugin!: CodexPluginManagement;
  readonly hookReceiver!: HookEventReceiver;
  readonly notesWorker!: NotesOutboxWorker;
  readonly logger!: Logger;

  private constructor(
    services: Omit<ElectronApplicationContainer, "close">,
    private readonly database: NodeSqliteSynapseDatabase,
    private readonly appServer: LazyCodexAppServerRuntime,
  ) { Object.assign(this, services); }

  static async create(app: App, onSessionsChanged: () => void): Promise<ElectronApplicationContainer> {
    const supportDirectory = app.getPath("userData");
    const logger = new CompositeLogger([
      new JsonConsoleLogger(),
      new JsonFileLogger(join(supportDirectory, "logs", "synapse.log")),
    ]);
    const clock = new SystemClock(); const ids = new UuidGenerator();
    const databasePath = join(supportDirectory, "synapse.sqlite3");
    const database = new NodeSqliteSynapseDatabase(databasePath, logger);
    const sessions = new SqliteCodexSessionRepository(database);
    const turns = new SqliteCodexTurnRepository(database);
    const hookEvents = new SqliteHookEventRepository(database);
    const profiles = new SqliteSummaryProfileRepository(database);
    const summaries = new SqliteSummaryDocumentRepository(database);
    const jobs = new SqliteSummaryJobRepository(database);
    const publications = new SqlitePublicationRepository(database);
    const outbox = new SqliteOutboxRepository(database);
    const settingsRepository = new SqliteSettingsRepository(database);
    const unitOfWork = new SqliteUnitOfWork(database);
    await jobs.failActive("Summary generation was interrupted because Synapse restarted.", clock.now());

    const awareness = new HookBasedSessionAwarenessService(new DefaultSessionLifecycleService(), sessions, turns, hookEvents, outbox, unitOfWork, clock, ids);
    const settingsValue = await settingsRepository.read();
    const appServer = new LazyCodexAppServerRuntime(settingsValue.codexBinaryPath, supportDirectory, logger);
    appServer.start();
    const summaryGeneration = new DestinationAwareSummaryGenerationService(
      new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
      appServer, profiles, summaries, sessions, jobs, unitOfWork, clock, ids, onSessionsChanged,
    );
    const finalization = new VersionedSummaryFinalizationService(summaries, sessions, outbox, publications, unitOfWork, clock, ids);
    const notesScript = resourcePath(app, "apple-notes-publisher.jxa");
    const notes = new AppleNotesSummaryPublisher(notesScript, logger);
    const publication = new OutboxSummaryPublicationService(summaries, publications, notes, clock, outbox);

    const codexDirectory = process.env.CODEX_HOME || join(homedir(), ".codex");
    const configStore = new JsonCodexHookConfigStore(codexDirectory, supportDirectory, logger);
    const relayPath = join(supportDirectory, "bin", "codex-hook-relay.sh");
    const relay = new FileSystemHookRelayInstaller(relayPath, resourcePath(app, "codex-hook-relay.sh"), logger);
    const hookManagement = new CodexHookManagementService(configStore, relay, appServer, sessions, configStore.hooksPath, logger, settingsRepository, homedir());
    const receiver = new UnixSocketHookEventReceiver(
      join(supportDirectory, "run", "hook.sock"), awareness, new CodexHookProtocolMapper(),
      new FileSystemHookEventSpool(join(supportDirectory, "spool")), logger, onSessionsChanged,
      appServerAgentRuntimeDirectory(supportDirectory),
    );
    const notesWorker = new NotesOutboxWorker(outbox, publication, clock, logger);

    const services = {
      sessionAwareness: awareness,
      sessionQueries: new RepositorySessionQueryService(sessions, clock, summaries, jobs),
      summaryQueries: new RepositorySummaryQueryService(summaries, publications),
      summaryGeneration,
      summaryDeletion: new TransactionalSummaryDeletionService(summaries, sessions, outbox, unitOfWork),
      summaryFinalization: finalization,
      summaryPublication: publication,
      profiles: new RepositoryProfileApplicationService(profiles, ids),
      settings: new PersistentSettingsApplicationService(settingsRepository, appServer, appServer, notes, unitOfWork),
      hookManagement,
      exports: new SystemExportApplicationService(summaries, new ElectronExportGateway(databasePath)),
      summaryReferences: new RepositorySummaryReferenceService(summaries, new ElectronTextClipboardGateway()),
      codexPlugin: new FileSystemCodexPluginManagement(resourcePath(app, "plugins/synapse-reference"), homedir(), settingsValue.codexBinaryPath, logger),
      hookReceiver: receiver,
      notesWorker,
      logger,
    };
    return new ElectronApplicationContainer(services as Omit<ElectronApplicationContainer, "close">, database, appServer);
  }

  async close(): Promise<void> {
    this.notesWorker.stop(); await this.hookReceiver.stop(); await this.appServer.close(); this.database.close();
  }
}

function resourcePath(app: App, fileName: string): string {
  return app.isPackaged ? join(process.resourcesPath, "resources", fileName) : join(app.getAppPath(), "resources", fileName);
}
