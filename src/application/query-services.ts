import { SummaryProfile } from "@domain/summary";
import type { AgentModel, ApplicationSettings, ApplicationSettingsUpdate, AppServerRuntimeStatus, AppServerRuntimeStatusProvider, Clock, CodexSessionRepository, ExportGateway, IdGenerator, NotesTargetGateway, SettingsRepository, SummaryAgentGateway, SummaryDocumentRepository, SummaryProfileRepository, SummarySearchCriteria, SummarySearchResult, UnitOfWork } from "./ports";
import type { ConversationTurnsView, NotesTargetsView, SaveProfileCommand, SummaryDetailView, SummaryProfileView, WidgetSessionView } from "./contracts";
import { DomainError } from "@domain/shared";

export interface SessionQueryService {
  listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
  getConversationTurns(sessionId: string): Promise<ConversationTurnsView>;
}

export class RepositorySessionQueryService implements SessionQueryService {
  constructor(
    private readonly sessions: CodexSessionRepository,
    private readonly clock: Clock,
    private readonly summaries: SummaryDocumentRepository,
  ) {}

  async listWidgetQueue(): Promise<readonly WidgetSessionView[]> {
    const now = Date.parse(this.clock.now());
    return Promise.all((await this.sessions.listWidgetQueue()).map(async (session) => {
      const lastTurn = session.turns.at(-1);
      const summary = await this.summaries.findLatestBySessionId(session.id);
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
}

export class RepositorySummaryQueryService implements SummaryQueryService {
  constructor(private readonly summaries: SummaryDocumentRepository) {}
  search(query: SummarySearchCriteria): Promise<SummarySearchResult> { return this.summaries.search(query); }

  async getDocument(documentId: string): Promise<SummaryDetailView> {
    const document = await this.summaries.findById(documentId);
    if (!document) throw new DomainError("SUMMARY_NOT_FOUND", "Summary document does not exist.");
    const current = document.currentVersion;
    return {
      id: document.id,
      sessionId: document.snapshot.sessionId,
      profileId: document.snapshot.profileId,
      selectedTurnIds: document.snapshot.selection.turnIds,
      publicationStatus: document.snapshot.publicationStatus,
      currentVersion: current ? { id: current.props.id, kind: current.props.kind, content: current.props.content, createdAt: current.props.createdAt } : null,
      versions: document.snapshot.versions.map((version) => ({ id: version.props.id, kind: version.props.kind, createdAt: version.props.createdAt })),
    };
  }
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
  runtime(): Promise<AppServerRuntimeStatus>;
}

export class PersistentSettingsApplicationService implements SettingsApplicationService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly agent: SummaryAgentGateway,
    private readonly runtimeStatus: AppServerRuntimeStatusProvider,
    private readonly notesTargets: NotesTargetGateway,
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
