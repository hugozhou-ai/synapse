import type { PublicationTarget, SummaryContent, SummaryProfileKind } from "@domain/summary";

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
  readonly publicationTarget: PublicationTarget | null;
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
  readonly content: SummaryContent;
}

export interface UpdateDraftCommand { readonly documentId: string; readonly content: SummaryContent; }
export interface FinalizeSummaryCommand { readonly documentId: string; readonly content: SummaryContent; readonly syncToNotes: boolean; }

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

export interface SummaryDetailView {
  readonly id: string;
  readonly sessionId: string;
  readonly profileId: string;
  readonly selectedTurnIds: readonly string[];
  readonly publicationStatus: string;
  readonly currentVersion: null | {
    readonly id: string;
    readonly kind: string;
    readonly content: SummaryContent;
    readonly createdAt: string;
  };
  readonly versions: readonly { id: string; kind: string; createdAt: string }[];
}

export interface SummaryProfileView {
  readonly id: string;
  readonly name: string;
  readonly kind: SummaryProfileKind;
  readonly instructions: string;
  readonly isDefault: boolean;
}

export interface SaveProfileCommand {
  readonly id?: string;
  readonly name: string;
  readonly kind: SummaryProfileKind;
  readonly instructions: string;
  readonly isDefault: boolean;
}
