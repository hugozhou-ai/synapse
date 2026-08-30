import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BetterSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteHookEventRepository, SqliteOutboxRepository, SqliteSummaryDocumentRepository } from "@infrastructure/sqlite/repositories";
import { BetterSqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { DefaultSessionLifecycleService } from "@domain/services";
import { HookBasedSessionAwarenessService } from "@application/session-services";
import { VersionedSummaryFinalizationService } from "@application/summary-services";
import { CodexSessionAggregate } from "@domain/session";
import { PublicationTarget, SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";
import { NotesOutboxWorker } from "@infrastructure/notes/outbox-worker";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("application services", () => {
  it("deduplicates Hook events and persists the lifecycle transition atomically", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      let id = 0;
      const service = new HookBasedSessionAwarenessService(new DefaultSessionLifecycleService(), sessions, turns, new SqliteHookEventRepository(database), new SqliteOutboxRepository(database), new BetterSqliteUnitOfWork(database), { now: () => "2026-01-01T00:00:01.000Z" }, { next: () => `id-${++id}` });
      const event = { eventType: "UserPromptSubmit" as const, sessionId: "session", threadId: "thread", turnId: "turn", cwd: "/repo", model: null, promptPreview: "prompt", assistantPreview: "", occurredAt: "2026-01-01T00:00:00.000Z", payloadHash: "hash" };
      expect((await service.ingest(event)).duplicate).toBe(false);
      expect((await service.ingest(event)).duplicate).toBe(true);
      expect((await sessions.findById("session"))?.status).toBe("running");
      expect(await turns.listBySessionId("session")).toHaveLength(1);
    } finally { database.close(); }
  });

  it("creates an immutable final, summarizes the source session, and enqueues Notes after the transaction", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const outbox = new SqliteOutboxRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a"); session.startTurn({ turnId: "turn", promptPreview: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantPreview: "done", at: "c" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: new PublicationTarget(null, "Synapse"), createdAt: "d", updatedAt: "d" });
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision(["turn"], "hash"), model: null, createdAt: "e" }));
      await summaries.save(document);
      let id = 0;
      const service = new VersionedSummaryFinalizationService(summaries, sessions, outbox, new BetterSqliteUnitOfWork(database), { now: () => "2026-01-01T00:00:00.000Z" }, { next: () => `final-id-${++id}` });
      const final = await service.finalize({ documentId: "doc", content: { title: "Edited", abstract: "Abstract", bodyMarkdown: "Final", tags: ["tag"] }, syncToNotes: true });
      expect(final.isFinal).toBe(true);
      expect((await summaries.findById("doc"))?.snapshot.versions).toHaveLength(2);
      expect((await sessions.findById("session"))?.status).toBe("summarized");
      expect(await outbox.listPending("notes-sync", 10)).toHaveLength(1);
    } finally { database.close(); }
  });

  it("attempts a failed Notes outbox message once until the user explicitly retries", async () => {
    const { database } = await testDatabase();
    try {
      const outbox = new SqliteOutboxRepository(database);
      await outbox.add({ id: "message", kind: "notes-sync", aggregateId: "doc", payload: {}, createdAt: "a", processedAt: null, attempts: 0, lastError: null });
      let attempts = 0;
      const worker = new NotesOutboxWorker(outbox, { async publishCurrent() { attempts += 1; throw new Error("permission denied"); }, async retry() {} }, { now: () => "now" }, logger);
      await worker.runOnce(); await worker.runOnce();
      expect(attempts).toBe(1);
      const row = database.connection.prepare("SELECT attempts,last_error FROM outbox WHERE id = ?").get("message") as { attempts: number; last_error: string };
      expect(row).toEqual({ attempts: 1, last_error: "permission denied" });
    } finally { database.close(); }
  });
});

async function testDatabase() {
  const root = await mkdtemp(join(tmpdir(), "synapse-application-")); directories.push(root);
  return { database: new BetterSqliteSynapseDatabase(join(root, "db.sqlite3"), logger) };
}
