import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BetterSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteSummaryDocumentRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { CodexSessionAggregate } from "@domain/session";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("SQLite repository contract", () => {
  it("migrates, restores aggregates, retains versions, and indexes the current summary in FTS5", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-")); directories.push(root);
    const database = new BetterSqliteSynapseDatabase(join(root, "synapse.sqlite3"), logger);
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
});
