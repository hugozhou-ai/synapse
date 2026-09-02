import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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
  it("migrates legacy turn previews into complete-content columns without losing data", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-migration-")); directories.push(root);
    const path = join(root, "synapse.sqlite3");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE codex_turns(
        id TEXT NOT NULL, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, status TEXT NOT NULL,
        prompt_preview TEXT NOT NULL, assistant_preview TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, 'a'), (2, 'b');
      INSERT INTO codex_turns VALUES ('turn', 'session', 0, 'completed', 'prompt', 'assistant', 'a', 'b');
      PRAGMA user_version = 2;
    `);
    legacy.close();
    const database = new NodeSqliteSynapseDatabase(path, logger);
    try {
      const row = database.connection.prepare("SELECT prompt_content, assistant_content FROM codex_turns").get() as { prompt_content: string; assistant_content: string };
      expect(row).toEqual({ prompt_content: "prompt", assistant_content: "assistant" });
      expect((database.connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(6);
    } finally { database.close(); }
  });

  it("backfills source and generation metadata when migrating a v3 database", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-v4-migration-")); directories.push(root);
    const path = join(root, "synapse.sqlite3");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE codex_sessions(id TEXT PRIMARY KEY);
      CREATE TABLE summary_documents(
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, notes_account TEXT, notes_folder TEXT,
        publication_status TEXT NOT NULL DEFAULT 'not-requested'
      );
      CREATE TABLE summary_versions(
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, abstract TEXT NOT NULL, body_markdown TEXT NOT NULL, tags_json TEXT NOT NULL,
        source_turn_ids_json TEXT NOT NULL, source_hash TEXT NOT NULL, model TEXT, output_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE summary_jobs(
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
        covered_turn_ids_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        stage_coverage_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE notes_exports(
        document_id TEXT PRIMARY KEY, publisher TEXT NOT NULL, external_id TEXT, account TEXT, folder TEXT NOT NULL,
        version_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE outbox(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL, processed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
      );
      INSERT INTO codex_sessions VALUES ('source');
      INSERT INTO summary_documents VALUES ('doc', 'source', NULL, 'Synapse', 'published');
      INSERT INTO summary_versions VALUES ('draft', 'doc', 0, 'agent-draft', 'T', '', 'Draft', '[]', '["turn"]', 'hash', NULL, '{}', 'before');
      INSERT INTO summary_versions VALUES ('version', 'doc', 1, 'final', 'T', '', 'B', '[]', '["turn"]', 'hash', NULL, '{}', 'now');
      INSERT INTO summary_jobs VALUES ('job', 'doc', 'succeeded', NULL, '["turn"]', 'now', 'now', '[]');
      INSERT INTO notes_exports VALUES ('doc', 'apple-notes', 'note-1', NULL, 'Synapse', 'version', 'published', NULL, 'now');
      INSERT INTO outbox VALUES ('message', 'notes-sync', 'doc', '{}', 'now', NULL, 0, NULL);
      INSERT INTO schema_migrations VALUES (1, 'a'), (2, 'b'), (3, 'c');
      PRAGMA user_version = 3;
    `);
    legacy.close();
    const database = new NodeSqliteSynapseDatabase(path, logger);
    try {
      const version = database.connection.prepare("SELECT source_session_id,generation_mode,base_version_id,parent_version_id,operation FROM summary_versions WHERE id = 'version'").get() as { source_session_id: string; generation_mode: string; base_version_id: string | null; parent_version_id: string | null; operation: string };
      const job = database.connection.prepare("SELECT source_session_id,generation_mode,base_version_id FROM summary_jobs").get() as { source_session_id: string; generation_mode: string; base_version_id: string | null };
      expect(version).toEqual({ source_session_id: "source", generation_mode: "new", base_version_id: null, parent_version_id: "draft", operation: "finalize" });
      expect(database.connection.prepare("SELECT parent_version_id,operation FROM summary_versions WHERE id = 'draft'").get()).toEqual({ parent_version_id: null, operation: "generate" });
      expect(job).toEqual({ source_session_id: "source", generation_mode: "new", base_version_id: null });
      expect(database.connection.prepare("SELECT publisher,external_id,target_json FROM publications").get()).toEqual({
        publisher: "apple-notes", external_id: "note-1", target_json: JSON.stringify({ kind: "apple-notes", account: null, folder: "Synapse" }),
      });
      expect(database.connection.prepare("SELECT kind FROM outbox").get()).toEqual({ kind: "publication-sync" });
      expect((database.connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(6);
    } finally { database.close(); }
  });

  it("migrates, restores aggregates, retains versions, and indexes the current summary in FTS5", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-sqlite-")); directories.push(root);
    const database = new NodeSqliteSynapseDatabase(join(root, "synapse.sqlite3"), logger);
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/projects/alpha", "2026-01-01T00:00:00.000Z");
      session.startTurn({ turnId: "turn", promptContent: "Implement search", at: "2026-01-01T00:00:01.000Z" });
      session.completeTurn({ turnId: "turn", assistantContent: "Implemented", at: "2026-01-01T00:00:02.000Z" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      expect((await sessions.findById("session"))?.turns[0]?.props.promptContent).toBe("Implement search");
      expect((await profiles.list())[0]?.id).toBe("builtin-task-retrospective");

      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "2026-01-01T00:00:03.000Z", updatedAt: "2026-01-01T00:00:03.000Z" });
      const revision = new SourceRevision("session", ["turn"], "hash");
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, baseVersionId: null, content: { title: "Search implementation", abstract: "SQLite FTS", bodyMarkdown: "Implemented a searchable archive.", tags: ["search"] }, sourceRevision: revision, model: "model", createdAt: "2026-01-01T00:00:04.000Z" }));
      await summaries.create(document);
      document.finalize(new SummaryVersion({ id: "final", documentId: "doc", sequence: 1, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: "draft", baseVersionId: null, content: { title: "Search implementation", abstract: "SQLite FTS", bodyMarkdown: "Implemented a searchable archive.", tags: ["search"] }, sourceRevision: revision, model: "model", createdAt: "2026-01-01T00:00:05.000Z" }), false);
      await summaries.save(document);
      database.connection.prepare("INSERT INTO publications(document_id,publisher,external_id,target_json,version_id,status,error,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("doc", "apple-notes", "note-1", JSON.stringify({ kind: "apple-notes", account: null, folder: "Synapse" }), "final", "published", null, "2026-01-01T00:00:06.000Z");
      const restored = await summaries.findById("doc");
      expect(restored?.snapshot.versions).toHaveLength(2);
      expect(restored?.currentVersion?.props).toMatchObject({ operation: "finalize", parentVersionId: "draft" });
      const result = await summaries.search({ text: "searchable", limit: 20, offset: 0 });
      expect(result.total).toBe(1); expect(result.items[0]).toMatchObject({ documentId: "doc", notesLinked: true });
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
      const outside = settings.save({ codexBinaryPath: null, summaryModel: "model", defaultPublicationKind: null, notionParentPageId: "", notesAccount: null, notesFolder: "Synapse", widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false }).then(() => { outsideCompleted = true; });
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
