import type { AgentModel, ApplicationSettings, AppServerRuntimeStatus, HookInstallationStatus, SummarySearchCriteria, SummarySearchResult } from "@application/ports";
import type { FinalizeSummaryCommand, GenerateSummaryCommand, RegenerateSummaryCommand, SaveProfileCommand, SummaryDetailView, SummaryDraft, SummaryProfileView, TurnSelectionView, UpdateDraftCommand, WidgetSessionView } from "@application/contracts";
import type { SummaryVersion } from "@domain/summary";

export interface SynapseApi {
  sessions: {
    listWidgetQueue(): Promise<readonly WidgetSessionView[]>;
    turns(sessionId: string): Promise<readonly TurnSelectionView[]>;
    ignore(sessionId: string): Promise<void>;
  };
  summaries: {
    generate(command: GenerateSummaryCommand): Promise<SummaryDraft>;
    regenerate(command: RegenerateSummaryCommand): Promise<SummaryDraft>;
    updateDraft(command: UpdateDraftCommand): Promise<SummaryDraft>;
    finalize(command: FinalizeSummaryCommand): Promise<SummaryVersion["props"]>;
    search(query: SummarySearchCriteria): Promise<SummarySearchResult>;
    get(documentId: string): Promise<SummaryDetailView>;
    retryNotes(documentId: string): Promise<void>;
  };
  profiles: {
    list(): Promise<readonly SummaryProfileView[]>;
    save(command: SaveProfileCommand): Promise<SummaryProfileView>;
    delete(id: string): Promise<void>;
  };
  settings: {
    read(): Promise<ApplicationSettings>;
    update(command: Partial<ApplicationSettings>): Promise<ApplicationSettings>;
    models(): Promise<readonly AgentModel[]>;
    runtime(): Promise<AppServerRuntimeStatus>;
  };
  hooks: {
    inspect(): Promise<HookInstallationStatus>;
    install(): Promise<HookInstallationStatus>;
    uninstall(): Promise<HookInstallationStatus>;
  };
  export: {
    markdown(documentId: string): Promise<string | null>;
    json(documentId: string): Promise<string | null>;
    revealDatabase(): Promise<void>;
  };
  window: {
    openHistory(): Promise<void>;
    openSummary(sessionId: string): Promise<void>;
    resizeWidget(expanded: boolean): Promise<void>;
    onSessionsChanged(listener: () => void): () => void;
    onNavigate(listener: (path: string) => void): () => void;
  };
}
