import type { CodexLifecycleEvent, CodexSessionAggregate, CodexTurn } from "./session";
import type { SummaryDocumentAggregate, SummaryProfile } from "./summary";

export interface CodexSessionRepository {
  findById(id: string): Promise<CodexSessionAggregate | null>;
  findByThreadId(threadId: string): Promise<CodexSessionAggregate | null>;
  save(session: CodexSessionAggregate): Promise<void>;
  listWidgetQueue(limit?: number): Promise<readonly CodexSessionAggregate[]>;
  search(input: { status?: string; cwd?: string; limit: number; offset: number }): Promise<readonly CodexSessionAggregate[]>;
}

export interface CodexTurnRepository {
  saveMany(sessionId: string, turns: readonly CodexTurn[]): Promise<void>;
}

export interface HookEventRepository {
  exists(deduplicationKey: string): Promise<boolean>;
  add(input: { deduplicationKey: string; event: CodexLifecycleEvent; receivedAt: string }): Promise<void>;
}

export interface SummaryProfileRepository {
  findById(id: string): Promise<SummaryProfile | null>;
  list(): Promise<readonly SummaryProfile[]>;
  save(profile: SummaryProfile): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SummaryDocumentRepository {
  findById(id: string): Promise<SummaryDocumentAggregate | null>;
  findLatestBySessionId(sessionId: string): Promise<SummaryDocumentAggregate | null>;
  hasFinalBySessionId(sessionId: string): Promise<boolean>;
  create(document: SummaryDocumentAggregate): Promise<void>;
  save(document: SummaryDocumentAggregate): Promise<void>;
  delete(id: string): Promise<void>;
}
