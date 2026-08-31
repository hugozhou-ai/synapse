export interface SummaryContentView {
  readonly title: string;
  readonly abstract: string;
  readonly bodyMarkdown: string;
  readonly tags: readonly string[];
}

export type SummaryProfileKindView = "template" | "systemPrompt";
export interface PublicationTargetInput { readonly account: string | null; readonly folder: string; }

export interface SessionTransitionResult {
  readonly sessionId: string;
  readonly status: string;
  readonly duplicate: boolean;
}

export interface ReplayResult { readonly accepted: number; readonly duplicates: number; readonly failed: number; }

export interface GenerateSummaryCommand {
  readonly sessionId: string;
  readonly selectedTurnIds: readonly string[];
  readonly profileId: string;
  readonly stopTurnId: string;
  readonly model: string | null;
  readonly syncToNotes: boolean;
  readonly publicationTarget: PublicationTargetInput | null;
}

export interface RegenerateSummaryCommand {
  readonly documentId: string;
  readonly selectedTurnIds: readonly string[];
  readonly profileId: string;
  readonly stopTurnId: string;
  readonly model: string | null;
}

export interface SummaryDraft {
  readonly documentId: string;
  readonly versionId: string;
  readonly content: SummaryContentView;
}

export interface UpdateDraftCommand { readonly documentId: string; readonly content: SummaryContentView; }
export interface FinalizeSummaryCommand { readonly documentId: string; readonly content: SummaryContentView; readonly syncToNotes: boolean; }

export interface FinalizedSummaryView {
  readonly id: string;
  readonly documentId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly content: SummaryContentView;
  readonly sourceRevision: { readonly turnIds: readonly string[]; readonly contentHash: string };
  readonly model: string | null;
  readonly createdAt: string;
}

export interface NotesTargetsView {
  readonly accounts: readonly {
    readonly name: string;
    readonly folders: readonly string[];
  }[];
}

export interface WidgetSessionView {
  readonly id: string;
  readonly threadId: string;
  readonly title: string;
  readonly cwd: string;
  readonly status: string;
  readonly promptPreview: string;
  readonly elapsedSeconds: number;
  readonly lastCompletedTurnId: string | null;
}

export interface TurnSelectionView {
  readonly id: string;
  readonly sequence: number;
  readonly status: string;
  readonly promptPreview: string;
  readonly assistantPreview: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly selectedByDefault: boolean;
}

export interface ConversationTurnsView {
  readonly turns: readonly TurnSelectionView[];
  readonly source: "app-server" | "hook-cache";
  readonly syncStatus: "synced" | "pending" | "unavailable";
  readonly message: string | null;
}

export interface SummaryDetailView {
  readonly id: string;
  readonly sessionId: string;
  readonly profileId: string;
  readonly selectedTurnIds: readonly string[];
  readonly publicationStatus: string;
  readonly currentVersion: null | {
    readonly id: string;
    readonly kind: string;
    readonly content: SummaryContentView;
    readonly createdAt: string;
  };
  readonly versions: readonly { id: string; kind: string; createdAt: string }[];
}

export interface SummaryProfileView {
  readonly id: string;
  readonly name: string;
  readonly kind: SummaryProfileKindView;
  readonly instructions: string;
  readonly isDefault: boolean;
}

export interface SaveProfileCommand {
  readonly id?: string;
  readonly name: string;
  readonly kind: SummaryProfileKindView;
  readonly instructions: string;
  readonly isDefault: boolean;
}
