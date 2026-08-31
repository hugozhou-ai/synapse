import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteHookEventRepository, SqliteOutboxRepository, SqliteSummaryDocumentRepository, SqliteSummaryJobRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { SqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { ArbitraryTurnSelectionService, DefaultSessionLifecycleService, NormalizedTurnSummaryContextService } from "@domain/services";
import { HookBasedSessionAwarenessService } from "@application/session-services";
import { ProfileDrivenSummaryGenerationService, TransactionalSummaryDeletionService, VersionedSummaryFinalizationService } from "@application/summary-services";
import { CodexSessionAggregate } from "@domain/session";
import { PublicationTarget, SourceRevision, SummaryDocumentAggregate, SummaryProfile, SummaryVersion, TurnSelection } from "@domain/summary";
import { NotesOutboxWorker } from "@infrastructure/notes/outbox-worker";
import { NodeContentHashService } from "@infrastructure/system";
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
      const service = new HookBasedSessionAwarenessService(new DefaultSessionLifecycleService(), sessions, turns, new SqliteHookEventRepository(database), new SqliteOutboxRepository(database), new SqliteUnitOfWork(database), { now: () => "2026-01-01T00:00:01.000Z" }, { next: () => `id-${++id}` });
      const event = { eventType: "UserPromptSubmit" as const, sessionId: "session", threadId: "thread", turnId: "turn", cwd: "/repo", model: null, promptContent: "prompt", assistantContent: "", occurredAt: "2026-01-01T00:00:00.000Z", payloadHash: "hash" };
      expect((await service.ingest(event)).duplicate).toBe(false);
      expect((await service.ingest(event)).duplicate).toBe(true);
      expect((await sessions.findById("session"))?.status).toBe("running");
      expect((await sessions.findById("session"))?.turns).toHaveLength(1);
    } finally { database.close(); }
  });

  it("creates an immutable final, summarizes the source session, and enqueues Notes after the transaction", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const outbox = new SqliteOutboxRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a"); session.startTurn({ turnId: "turn", promptContent: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "c" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: new PublicationTarget(null, "Synapse"), createdAt: "d", updatedAt: "d" });
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision(["turn"], "hash"), model: null, createdAt: "e" }));
      await summaries.create(document);
      let id = 0;
      const service = new VersionedSummaryFinalizationService(summaries, sessions, outbox, new SqliteUnitOfWork(database), { now: () => "2026-01-01T00:00:00.000Z" }, { next: () => `final-id-${++id}` });
      const final = await service.finalize({ documentId: "doc", content: { title: "Edited", abstract: "Abstract", bodyMarkdown: "Final", tags: ["tag"] }, syncToNotes: true });
      expect(final.isFinal).toBe(true);
      expect((await summaries.findById("doc"))?.snapshot.versions).toHaveLength(2);
      expect((await sessions.findById("session"))?.status).toBe("summarized");
      expect(await outbox.listPending("notes-sync", 10)).toHaveLength(1);
    } finally { database.close(); }
  });

  it("deletes a summary and all local dependents without allowing stale writes to restore it", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database); const outbox = new SqliteOutboxRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
      session.startTurn({ turnId: "turn", promptContent: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "c" }); session.markSummarized("d");
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "d", updatedAt: "d" });
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision(["turn"], "hash"), model: null, createdAt: "e" }));
      await summaries.create(document);
      await jobs.save({ id: "job", documentId: "doc", status: "succeeded", error: null, coveredTurnIds: ["turn"], stageCoverage: [], createdAt: "e", updatedAt: "e" });
      await outbox.add({ id: "message", kind: "notes-sync", aggregateId: "doc", payload: {}, createdAt: "e", processedAt: null, attempts: 0, lastError: null });
      database.connection.prepare("INSERT INTO notes_exports(document_id,publisher,external_id,account,folder,version_id,status,error,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run("doc", "apple-notes", "note", null, "Synapse", "draft", "published", null, "e");

      const service = new TransactionalSummaryDeletionService(summaries, sessions, outbox, new SqliteUnitOfWork(database));
      await service.delete("doc");

      expect(await summaries.findById("doc")).toBeNull();
      expect((await sessions.findById("session"))?.snapshot).toMatchObject({ status: "ready", summarizedAt: null });
      for (const table of ["summary_versions", "summary_jobs", "notes_exports", "summary_fts", "outbox"]) {
        expect((database.connection.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count).toBe(0);
      }
      await expect(summaries.save(document)).rejects.toThrow("Summary document does not exist.");
      expect(await summaries.findById("doc")).toBeNull();
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

  it("persists a regenerated draft with its new profile and turn selection", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
      session.startTurn({ turnId: "turn-1", promptContent: "one", at: "b" }); session.completeTurn({ turnId: "turn-1", assistantContent: "done-one", at: "c" });
      session.startTurn({ turnId: "turn-2", promptContent: "two", at: "d" }); session.completeTurn({ turnId: "turn-2", assistantContent: "done-two", at: "e" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      await profiles.save(new SummaryProfile("new-profile", "New profile", "systemPrompt", "Summarize", false));
      await summaries.create(SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn-1"]), publicationTarget: null, createdAt: "f", updatedAt: "f" }));
      let id = 0;
      let source = "";
      const service = new ProfileDrivenSummaryGenerationService(
        new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
        { async generate(request) { source = request.context.chunks[0]?.content ?? ""; return { title: "New", abstract: "", bodyMarkdown: "Body", tags: [], model: null, stages: [{ kind: "final", turnIds: ["turn-2"] }] }; }, async cancel() {}, async listModels() { return []; } },
        profiles, summaries, sessions, jobs, new SqliteUnitOfWork(database), { now: () => "g" }, { next: () => `generated-${++id}` },
      );
      await service.regenerate({ documentId: "doc", selectedTurnIds: ["turn-2"], profileId: "new-profile", model: null });
      const saved = await summaries.findById("doc");
      expect(saved?.snapshot.profileId).toBe("new-profile");
      expect(saved?.snapshot.selection.turnIds).toEqual(["turn-2"]);
      expect(saved?.currentVersion?.props.sourceRevision.turnIds).toEqual(["turn-2"]);
      expect(source).toContain("two");
      expect(source).toContain("done-two");
    } finally { database.close(); }
  });
});

async function testDatabase() {
  const root = await mkdtemp(join(tmpdir(), "synapse-application-")); directories.push(root);
  return { database: new NodeSqliteSynapseDatabase(join(root, "db.sqlite3"), logger) };
}
