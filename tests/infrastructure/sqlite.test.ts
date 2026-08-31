import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteSettingsRepository, SqliteSummaryDocumentRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { SqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { CodexSessionAggregate } from "@domain/session";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("SQLite repository contract", () => {
  it("migrates, restores aggregates, retains versions, and indexes the current summary in FTS5", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-")); directories.push(root);
    const database = new NodeSqliteSynapseDatabase(join(root, "synapse.sqlite3"), logger);
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/projects/alpha", "2026-01-01T00:00:00.000Z");
      session.startTurn({ turnId: "turn", promptPreview: "Implement search", at: "2026-01-01T00:00:01.000Z" });
      session.completeTurn({ turnId: "turn", assistantPreview: "Implemented", at: "2026-01-01T00:00:02.000Z" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      expect((await sessions.findById("session"))?.turns[0]?.props.promptPreview).toBe("Implement search");
      expect((await profiles.list())[0]?.id).toBe("builtin-task-retrospective");

      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "2026-01-01T00:00:03.000Z", updatedAt: "2026-01-01T00:00:03.000Z" });
      const revision = new SourceRevision(["turn"], "hash");
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", content: { title: "Search implementation", abstract: "SQLite FTS", bodyMarkdown: "Implemented a searchable archive.", tags: ["search"] }, sourceRevision: revision, model: "model", createdAt: "2026-01-01T00:00:04.000Z" }));
      await summaries.save(document);
      document.finalize(new SummaryVersion({ id: "final", documentId: "doc", sequence: 1, kind: "final", content: { title: "Search implementation", abstract: "SQLite FTS", bodyMarkdown: "Implemented a searchable archive.", tags: ["search"] }, sourceRevision: revision, model: "model", createdAt: "2026-01-01T00:00:05.000Z" }), false);
      await summaries.save(document);
      expect((await summaries.findById("doc"))?.snapshot.versions).toHaveLength(2);
      const result = await summaries.search({ text: "searchable", limit: 20, offset: 0 });
      expect(result.total).toBe(1); expect(result.items[0]?.documentId).toBe("doc");
    } finally { database.close(); }
  });

  it("holds the connection-wide queue until an asynchronous transaction rolls back", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-uow-")); directories.push(root);
    const database = new NodeSqliteSynapseDatabase(join(root, "synapse.sqlite3"), logger);
    try {
      const sessions = new SqliteCodexSessionRepository(database); const settings = new SqliteSettingsRepository(database);
      const unitOfWork = new SqliteUnitOfWork(database);
      let entered!: () => void; const enteredTransaction = new Promise<void>((resolve) => { entered = resolve; });
      let unblock!: () => void; const blocker = new Promise<void>((resolve) => { unblock = resolve; });
      const transaction = unitOfWork.execute(async () => {
        await sessions.save(CodexSessionAggregate.create("rolled-back", "thread", "/repo", "now"));
        entered(); await blocker; throw new Error("rollback");
      });
      await enteredTransaction;
      let outsideCompleted = false;
      const outside = settings.save({ codexBinaryPath: null, summaryModel: "model", syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse", widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false }).then(() => { outsideCompleted = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(outsideCompleted).toBe(false);
      unblock();
      await expect(transaction).rejects.toThrow("rollback");
      await outside;
      expect(await sessions.findById("rolled-back")).toBeNull();
      expect((await settings.read()).summaryModel).toBe("model");
    } finally { database.close(); }
  });
});
