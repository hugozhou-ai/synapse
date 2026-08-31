import type { AgentModel, ApplicationSettings, ApplicationSettingsUpdate, AppServerRuntimeStatus, HookInstallationStatus, SummarySearchCriteria, SummarySearchResult } from "@application/ports";
import type { ConversationTurnsView, FinalizeSummaryCommand, FinalizedSummaryView, GenerateSummaryCommand, NotesTargetsView, RegenerateSummaryCommand, RendererErrorReport, SaveProfileCommand, SummaryDetailView, SummaryDraft, SummaryProfileView, UpdateDraftCommand, WidgetSessionView } from "@application/contracts";

export interface SynapseApi {
  sessions: {
    listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
    turns(sessionId: string): Promise<ConversationTurnsView>;
    ignore(sessionId: string): Promise<void>;
  };
  summaries: {
    generate(command: GenerateSummaryCommand): Promise<SummaryDraft>;
    generateDefault(sessionId: string): Promise<SummaryDraft>;
    regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft>;
    updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft>;
    finalize(command: FinalizeSummaryCommand): Promise<FinalizedSummaryView>;
    search(query: SummarySearchCriteria): Promise<SummarySearchResult>;
    get(documentId: string): Promise<SummaryDetailView>;
    delete(documentId: string): Promise<void>;
    retryNotes(documentId: string): Promise<void>;
  };
  profiles: {
    list(): Promise<readonly SummaryProfileView[]>;
    save(command: SaveProfileCommand): Promise<SummaryProfileView>;
    delete(id: string): Promise<void>;
  };
  settings: {
    read(): Promise<ApplicationSettings>;
    update(command: ApplicationSettingsUpdate): Promise<ApplicationSettings>;
    models(): Promise<readonly AgentModel[]>;
    notesTargets(): Promise<NotesTargetsView>;
    runtime(): Promise<AppServerRuntimeStatus>;
  };
  hooks: {
    inspect(): Promise<HookInstallationStatus>;
    install(): Promise<HookInstallationStatus>;
    trust(): Promise<HookInstallationStatus>;
    uninstall(): Promise<HookInstallationStatus>;
    dismissOnboarding(): Promise<HookInstallationStatus>;
  };
  export: {
    markdown(documentId: string): Promise<string | null>;
    json(documentId: string): Promise<string | null>;
    revealDatabase(): Promise<void>;
  };
  diagnostics: {
    reportRendererError(report: RendererErrorReport): Promise<void>;
  };
  window: {
    openHistory(): Promise<void>;
    openQueue(): Promise<void>;
    openSettings(): Promise<void>;
    openSummaryResult(documentId: string): Promise<void>;
    resizeWidget(expanded: boolean): Promise<void>;
    onSessionsChanged(listener: () => void): () => void;
    onNavigate(listener: (path: string) => void): () => void;
  };
}
