export interface SummaryContentView {
  readonly title: string;
  readonly abstract: string;
  readonly bodyMarkdown: string;
  readonly tags: readonly string[];
}

export type SummaryProfileKindView = "template" | "systemPrompt";
export type PublicationTargetInput = {
  readonly kind: "apple-notes";
  readonly account: string | null;
  readonly folder: string;
} | {
  readonly kind: "notion";
  readonly parentPageId: string;
};

export interface SessionTransitionResult {
  readonly sessionId: string;
  readonly status: string;
  readonly duplicate: boolean;
}

export interface ReplayResult { readonly accepted: number; readonly duplicates: number; readonly failed: number; }

interface GenerateSummaryCommandBase {
  readonly sessionId: string;
  readonly selectedTurnIds: readonly string[];
  readonly model: string | null;
}

export type GenerateSummaryCommand = GenerateSummaryCommandBase & {
  readonly destination: {
    readonly kind: "new";
    readonly profileId: string;
    readonly publicationTarget: PublicationTargetInput | null;
  } | {
    readonly kind: "existing";
    readonly targetDocumentId: string;
  };
};

export interface RegenerateSummaryCommand {
  readonly documentId: string;
  readonly model: string | null;
}

export interface SummaryDraft {
  readonly documentId: string;
  readonly versionId: string;
  readonly content: SummaryContentView;
}

export interface UpdateDraftCommand { readonly documentId: string; readonly expectedVersionId: string; readonly content: SummaryContentView; }
export interface FinalizeSummaryCommand { readonly documentId: string; readonly expectedVersionId: string; readonly content: SummaryContentView; }

export interface FinalizedSummaryView {
  readonly id: string;
  readonly documentId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly generationMode: "new" | "merge";
  readonly operation: SummaryVersionOperationView;
  readonly parentVersionId: string | null;
  readonly baseVersionId: string | null;
  readonly content: SummaryContentView;
  readonly sourceRevision: { readonly sessionId: string; readonly turnIds: readonly string[]; readonly contentHash: string };
  readonly model: string | null;
  readonly createdAt: string;
}

export interface NotesTargetsView {
  readonly accounts: readonly {
    readonly name: string;
    readonly folders: readonly string[];
  }[];
}

export interface NotionConnectionView {
  readonly available: boolean;
  readonly connected: boolean;
  readonly message: string | null;
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
  readonly summaryDocumentId: string | null;
  readonly summaryInProgress: boolean;
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
}

export type SummaryVersionOperationView = "generate" | "merge" | "regenerate" | "manual-edit" | "finalize";

export interface SummaryVersionView {
  readonly id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly generationMode: "new" | "merge";
  readonly operation: SummaryVersionOperationView;
  readonly parentVersionId: string | null;
  readonly baseVersionId: string | null;
  readonly sourceSessionId: string;
  readonly sourceTurnIds: readonly string[];
  readonly sourceHash: string;
  readonly model: string | null;
  readonly content: SummaryContentView;
  readonly createdAt: string;
}

export interface SummaryVersionSourceView {
  readonly available: boolean;
  readonly session: null | {
    readonly sessionId: string;
    readonly threadId: string;
    readonly title: string | null;
    readonly cwd: string;
    readonly model: string | null;
    readonly status: string;
  };
  readonly turns: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly status: string;
    readonly promptContent: string;
    readonly assistantContent: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
  }[];
  readonly missingTurnIds: readonly string[];
}

export interface SummaryDetailView {
  readonly id: string;
  readonly reference: null | { readonly uri: string; readonly text: string };
  readonly publicationStatus: string;
  readonly notesLinked: boolean;
  readonly notionLinked: boolean;
  readonly publisher: "apple-notes" | "notion" | null;
  readonly currentVersion: SummaryVersionView | null;
  readonly versions: readonly SummaryVersionView[];
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

export interface RendererErrorReport {
  readonly kind: "window-error" | "unhandled-rejection" | "react-error";
  readonly message: string;
  readonly stack: string | null;
  readonly componentStack: string | null;
}
