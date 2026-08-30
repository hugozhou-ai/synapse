import type { TurnStatus } from "./session";

export type ConversationItemType = "user" | "agent" | "plan" | "file-change" | "command";

export interface ConversationItem {
  readonly type: ConversationItemType;
  readonly text: string;
  readonly status?: string;
}

export interface ConversationTurn {
  readonly id: string;
  readonly sequence: number;
  readonly status: TurnStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly items: readonly ConversationItem[];
}

export interface CodexConversation {
  readonly threadId: string;
  readonly turns: readonly ConversationTurn[];
}

export interface SummaryContextChunk {
  readonly turnIds: readonly string[];
  readonly content: string;
}

export interface SummaryContext {
  readonly sourceTurnIds: readonly string[];
  readonly sourceHash: string;
  readonly chunks: readonly SummaryContextChunk[];
}

export interface GeneratedSummary {
  readonly title: string;
  readonly abstract: string;
  readonly bodyMarkdown: string;
  readonly tags: readonly string[];
  readonly model: string | null;
  readonly stages: readonly { readonly kind: "chunk" | "final"; readonly turnIds: readonly string[] }[];
}
