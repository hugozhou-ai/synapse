import { SummaryProfile } from "@domain/summary";
import type { AgentModel, ApplicationSettings, AppServerRuntimeStatus, Clock, CodexSessionRepository, CodexTurnRepository, ConversationGateway, ExportGateway, IdGenerator, SettingsRepository, SummaryAgentGateway, SummaryDocumentRepository, SummaryProfileRepository, SummarySearchCriteria, SummarySearchResult } from "./ports";
import type { SaveProfileCommand, SummaryDetailView, SummaryProfileView, TurnSelectionView, WidgetSessionView } from "./contracts";
import { DomainError } from "@domain/shared";

export interface SessionQueryService {
  listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
  getConversationTurns(sessionId: string): Promise<readonly TurnSelectionView[]>;
}

export class RepositorySessionQueryService implements SessionQueryService {
  constructor(
    private readonly sessions: CodexSessionRepository,
    private readonly turns: CodexTurnRepository,
    private readonly clock: Clock,
    private readonly conversations?: ConversationGateway,
  ) {}

  async listWidgetQueue(): Promise<readonly WidgetSessionView[]> {
    const now = Date.parse(this.clock.now());
    return (await this.sessions.listWidgetQueue()).map((session) => {
      const lastTurn = session.turns.at(-1);
      return {
        id: session.id,
        threadId: session.threadId,
        title: session.snapshot.title ?? lastTurn?.props.promptPreview ?? "未命名任务",
        cwd: session.snapshot.cwd,
        status: session.status,
        promptPreview: lastTurn?.props.promptPreview ?? "",
        elapsedSeconds: Math.max(0, Math.floor(((lastTurn?.props.completedAt ? Date.parse(lastTurn.props.completedAt) : now) - Date.parse(lastTurn?.props.startedAt ?? session.snapshot.lastEventAt)) / 1000)),
        lastCompletedTurnId: session.snapshot.lastCompletedTurnId,
      };
    });
  }

  async getConversationTurns(sessionId: string): Promise<readonly TurnSelectionView[]> {
    const session = await this.sessions.findById(sessionId);
    if (session && this.conversations) {
      try {
        const conversation = session.snapshot.lastCompletedTurnId
          ? await this.conversations.waitUntilTurnPersisted(session.threadId, session.snapshot.lastCompletedTurnId)
          : await this.conversations.readConversation(session.threadId);
        return conversation.turns.map((turn) => {
          const user = turn.items.find((item) => item.type === "user")?.text ?? "";
          const agent = [...turn.items].reverse().find((item) => item.type === "agent")?.text ?? "";
          return {
            id: turn.id, sequence: turn.sequence, status: turn.status,
            promptPreview: preview(user), assistantPreview: preview(agent), startedAt: turn.startedAt,
            completedAt: turn.completedAt, selectedByDefault: turn.status === "completed",
          };
        });
      } catch { /* The local Hook cache keeps monitoring usable when App Server is unavailable or still syncing. */ }
    }
    const turns = await this.turns.listBySessionId(sessionId);
    return turns.map((turn) => ({
      id: turn.id,
      sequence: turn.sequence,
      status: turn.status,
      promptPreview: turn.props.promptPreview,
      assistantPreview: turn.props.assistantPreview,
      startedAt: turn.props.startedAt,
      completedAt: turn.props.completedAt,
      selectedByDefault: turn.status === "completed",
    }));
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
  update(command: Partial<ApplicationSettings>): Promise<ApplicationSettings>;
  listModels(): Promise<readonly AgentModel[]>;
  runtime(): Promise<AppServerRuntimeStatus>;
}

export class PersistentSettingsApplicationService implements SettingsApplicationService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly agent: SummaryAgentGateway,
    private readonly runtimeStatus: AppServerRuntimeStatus,
  ) {}
  read(): Promise<ApplicationSettings> { return this.settings.read(); }
  async update(command: Partial<ApplicationSettings>): Promise<ApplicationSettings> {
    const updated = { ...await this.settings.read(), ...command };
    await this.settings.save(updated);
    return updated;
  }
  listModels(): Promise<readonly AgentModel[]> { return this.agent.listModels(); }
  runtime(): Promise<AppServerRuntimeStatus> { return Promise.resolve(this.runtimeStatus); }
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
