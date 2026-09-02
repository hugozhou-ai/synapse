import type { AgentModel, ApplicationSettings, ApplicationSettingsUpdate, AppServerRuntimeStatus, CodexPluginInstallationStatus, HookInstallationStatus, SummarySearchCriteria, SummarySearchResult } from "@application/ports";
import type { ConversationTurnsView, FinalizeSummaryCommand, FinalizedSummaryView, GenerateSummaryCommand, NotesTargetsView, NotionConnectionView, RegenerateSummaryCommand, RendererErrorReport, SaveProfileCommand, SummaryDetailView, SummaryDraft, SummaryProfileView, UpdateDraftCommand, WidgetSessionView } from "@application/contracts";
import type { WidgetBounds } from "./widget-layout";

export interface SynapseApi {
  sessions: {
    listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
    turns(sessionId: string): Promise<ConversationTurnsView>;
    ignore(sessionId: string): Promise<void>;
  };
  summaries: {
    generate(command: GenerateSummaryCommand): Promise<SummaryDraft>;
    regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft>;
    updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft>;
    finalize(command: FinalizeSummaryCommand): Promise<FinalizedSummaryView>;
    search(query: SummarySearchCriteria): Promise<SummarySearchResult>;
    get(documentId: string): Promise<SummaryDetailView>;
    copyReference(documentId: string, versionId: string): Promise<{ readonly uri: string; readonly text: string }>;
    delete(documentId: string): Promise<void>;
    retryPublication(documentId: string): Promise<void>;
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
    notionConnection(): Promise<NotionConnectionView>;
    runtime(): Promise<AppServerRuntimeStatus>;
  };
  hooks: {
    inspect(): Promise<HookInstallationStatus>;
    install(): Promise<HookInstallationStatus>;
    trust(): Promise<HookInstallationStatus>;
    uninstall(): Promise<HookInstallationStatus>;
    dismissOnboarding(): Promise<HookInstallationStatus>;
  };
  plugin: {
    inspect(): Promise<CodexPluginInstallationStatus>;
    install(): Promise<CodexPluginInstallationStatus>;
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
    openSummary(sessionId: string): Promise<void>;
    openSummaryResult(documentId: string): Promise<void>;
    resizeWidget(bounds: WidgetBounds): Promise<void>;
    beginWidgetDrag(pointer: { x: number; y: number }): Promise<void>;
    moveWidgetDrag(pointer: { x: number; y: number }): Promise<void>;
    endWidgetDrag(): Promise<void>;
    dismissWidget(): Promise<void>;
    onWidgetBlur(listener: () => void): () => void;
    onSessionsChanged(listener: () => void): () => void;
    onNavigate(listener: (path: string) => void): () => void;
  };
}
