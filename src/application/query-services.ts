import { SummaryProfile, type SummaryVersion } from "@domain/summary";
import type { AgentModel, ApplicationSettings, ApplicationSettingsUpdate, AppServerRuntimeStatus, AppServerRuntimeStatusProvider, Clock, CodexSessionRepository, ExportGateway, IdGenerator, NotesTargetGateway, NotionConnectionGateway, PublicationRepository, SettingsRepository, SummaryAgentGateway, SummaryDocumentRepository, SummaryJobRepository, SummaryProfileRepository, SummarySearchCriteria, SummarySearchResult, UnitOfWork } from "./ports";
import type { ConversationTurnsView, NotesTargetsView, NotionConnectionView, SaveProfileCommand, SummaryDetailView, SummaryProfileView, SummaryVersionSourceView, SummaryVersionView, WidgetSessionView } from "./contracts";
import { DomainError } from "@domain/shared";
import { formatSummaryReference } from "./summary-reference";

export interface SessionQueryService {
  listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
  getConversationTurns(sessionId: string): Promise<ConversationTurnsView>;
}

export class RepositorySessionQueryService implements SessionQueryService {
  constructor(
    private readonly sessions: CodexSessionRepository,
    private readonly clock: Clock,
    private readonly summaries: SummaryDocumentRepository,
    private readonly jobs: SummaryJobRepository,
  ) {}

  async listWidgetQueue(): Promise<readonly WidgetSessionView[]> {
    const now = Date.parse(this.clock.now());
    return Promise.all((await this.sessions.listWidgetQueue()).map(async (session) => {
      const lastTurn = session.turns.at(-1);
      const [summary, activeJob] = await Promise.all([
        this.summaries.findLatestBySessionId(session.id),
        this.jobs.findActiveBySessionId(session.id),
      ]);
      return {
        id: session.id,
        threadId: session.threadId,
        title: session.snapshot.title || preview(lastTurn?.props.promptContent ?? "") || "未命名任务",
        cwd: session.snapshot.cwd,
        status: session.status,
        promptPreview: preview(lastTurn?.props.promptContent ?? ""),
        elapsedSeconds: Math.max(0, Math.floor(((lastTurn?.props.completedAt ? Date.parse(lastTurn.props.completedAt) : now) - Date.parse(lastTurn?.props.startedAt ?? session.snapshot.lastEventAt)) / 1000)),
        lastCompletedTurnId: session.snapshot.lastCompletedTurnId,
        summaryDocumentId: summary?.currentVersion ? summary.id : null,
        summaryInProgress: activeJob !== null,
      };
    }));
  }

  async getConversationTurns(sessionId: string): Promise<ConversationTurnsView> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new DomainError("SESSION_NOT_FOUND", "Session does not exist.");
    return { turns: session.turns.map((turn) => ({
      id: turn.id,
      sequence: turn.sequence,
      status: turn.status,
      promptPreview: preview(turn.props.promptContent),
      assistantPreview: preview(turn.props.assistantContent),
      startedAt: turn.props.startedAt,
      completedAt: turn.props.completedAt,
      selectedByDefault: turn.status === "completed",
    })) };
  }
}

function preview(value: string): string { return value.replaceAll(/\s+/g, " ").trim().slice(0, 280); }

export interface SummaryQueryService {
  search(query: SummarySearchCriteria): Promise<SummarySearchResult>;
  getDocument(documentId: string): Promise<SummaryDetailView>;
  getVersionSource(documentId: string, versionId: string): Promise<SummaryVersionSourceView>;
}

export class RepositorySummaryQueryService implements SummaryQueryService {
  constructor(
    private readonly summaries: SummaryDocumentRepository,
    private readonly publications: PublicationRepository,
    private readonly sessions: CodexSessionRepository,
  ) {}
  search(query: SummarySearchCriteria): Promise<SummarySearchResult> { return this.summaries.search(query); }

  async getDocument(documentId: string): Promise<SummaryDetailView> {
    const document = await this.summaries.findById(documentId);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const current = document.currentVersion;
    const publication = await this.publications.find(document.id);
    return {
      id: document.id,
      reference: current ? formatSummaryReference(document.id, current.props.id, current.props.content.title) : null,
      publicationStatus: document.snapshot.publicationStatus,
      notesLinked: publication?.publisher === "apple-notes" && Boolean(publication.externalId),
      notionLinked: publication?.publisher === "notion" && Boolean(publication.externalId),
      publisher: publication?.publisher ?? null,
      currentVersion: current ? toVersionView(current) : null,
      versions: document.snapshot.versions.map(toVersionView),
    };
  }

  async getVersionSource(documentId: string, versionId: string): Promise<SummaryVersionSourceView> {
    const document = await this.summaries.findById(documentId);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const version = document.version(versionId);
    if (!version) throw new DomainError("SUMMARY_VERSION_NOT_FOUND", "Summary version does not belong to this document.");
    const session = await this.sessions.findById(version.props.sourceRevision.sessionId);
    if (!session) return { available: false, session: null, turns: [], missingTurnIds: version.props.sourceRevision.turnIds };
    const selected = new Set(version.props.sourceRevision.turnIds);
    const turns = session.turns.filter((turn) => selected.has(turn.id)).map((turn) => ({
      id: turn.id, sequence: turn.sequence, status: turn.status,
      promptContent: turn.props.promptContent, assistantContent: turn.props.assistantContent,
      startedAt: turn.props.startedAt, completedAt: turn.props.completedAt,
    }));
    const found = new Set(turns.map((turn) => turn.id));
    const missingTurnIds = version.props.sourceRevision.turnIds.filter((id) => !found.has(id));
    return {
      available: missingTurnIds.length === 0,
      session: {
        sessionId: session.id, threadId: session.threadId, title: session.snapshot.title,
        cwd: session.snapshot.cwd, model: session.snapshot.model, status: session.status,
      },
      turns, missingTurnIds,
    };
  }
}

function toVersionView(version: SummaryVersion): SummaryVersionView {
  const props = version.props;
  return {
    id: props.id, sequence: props.sequence, kind: props.kind, generationMode: props.generationMode,
    operation: props.operation, parentVersionId: props.parentVersionId, baseVersionId: props.baseVersionId,
    sourceSessionId: props.sourceRevision.sessionId, sourceTurnIds: props.sourceRevision.turnIds,
    sourceHash: props.sourceRevision.contentHash, model: props.model, content: props.content, createdAt: props.createdAt,
  };
}

export interface ProfileApplicationService {
  list(): Promise<readonly SummaryProfileView[]>;
  save(command: SaveProfileCommand): Promise<SummaryProfileView>;
  delete(id: string): Promise<void>;
}

export class RepositoryProfileApplicationService implements ProfileApplicationService {
  constructor(private readonly profiles: SummaryProfileRepository, private readonly ids: IdGenerator) {}

  async list(): Promise<readonly SummaryProfileView[]> { return (await this.profiles.list()).map(toProfileView); }
  async save(command: SaveProfileCommand): Promise<SummaryProfileView> {
    const profile = new SummaryProfile(command.id ?? this.ids.next(), command.name, command.kind, command.instructions, command.isDefault);
    await this.profiles.save(profile);
    return toProfileView(profile);
  }
  delete(id: string): Promise<void> { return this.profiles.delete(id); }
}

function toProfileView(profile: SummaryProfile): SummaryProfileView {
  return { id: profile.id, name: profile.name, kind: profile.kind, instructions: profile.instructions, isDefault: profile.isDefault };
}

export interface SettingsApplicationService {
  read(): Promise<ApplicationSettings>;
  update(command: ApplicationSettingsUpdate): Promise<ApplicationSettings>;
  listModels(): Promise<readonly AgentModel[]>;
  listNotesTargets(): Promise<NotesTargetsView>;
  inspectNotionConnection(): Promise<NotionConnectionView>;
  runtime(): Promise<AppServerRuntimeStatus>;
}

export class PersistentSettingsApplicationService implements SettingsApplicationService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly agent: SummaryAgentGateway,
    private readonly runtimeStatus: AppServerRuntimeStatusProvider,
    private readonly notesTargets: NotesTargetGateway,
    private readonly notion: NotionConnectionGateway,
    private readonly unitOfWork: UnitOfWork,
  ) {}
  read(): Promise<ApplicationSettings> { return this.settings.read(); }
  async update(command: ApplicationSettingsUpdate): Promise<ApplicationSettings> {
    return this.unitOfWork.execute(async () => {
      const updated = { ...await this.settings.read(), ...command };
      await this.settings.save(updated);
      return updated;
    });
  }
  listModels(): Promise<readonly AgentModel[]> { return this.agent.listModels(); }
  listNotesTargets(): Promise<NotesTargetsView> { return this.notesTargets.listTargets(); }
  inspectNotionConnection(): Promise<NotionConnectionView> { return this.notion.inspectConnection(); }
  runtime(): Promise<AppServerRuntimeStatus> { return this.runtimeStatus.current(); }
}

export interface ExportApplicationService {
  markdown(documentId: string): Promise<string | null>;
  json(documentId: string): Promise<string | null>;
  revealDatabaseDirectory(): Promise<void>;
}

export class SystemExportApplicationService implements ExportApplicationService {
  constructor(private readonly summaries: SummaryDocumentRepository, private readonly gateway: ExportGateway) {}
  async markdown(id: string): Promise<string | null> { return this.gateway.exportMarkdown(await this.requireDocument(id)); }
  async json(id: string): Promise<string | null> { return this.gateway.exportJson(await this.requireDocument(id)); }
  revealDatabaseDirectory(): Promise<void> { return this.gateway.revealDatabaseDirectory(); }
  private async requireDocument(id: string) {
    const document = await this.summaries.findById(id);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    return document;
  }
}
