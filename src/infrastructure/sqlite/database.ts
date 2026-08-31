import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "@shared/logger";

export interface SynapseDatabase {
  readonly connection: DatabaseSync;
  readonly path: string;
  execute<T>(operation: () => T): Promise<T>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  close(): void;
}

export class NodeSqliteSynapseDatabase implements SynapseDatabase {
  readonly connection: DatabaseSync;
  private readonly transactionContext = new AsyncLocalStorage<boolean>();
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly path: string, logger: Logger) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
    logger.info("[synapse:sqlite]", "database-ready", { path });
  }

  close(): void { this.connection.close(); }

  execute<T>(operation: () => T): Promise<T> {
    if (this.transactionContext.getStore()) return Promise.resolve(operation());
    return this.enqueue(operation);
  }

  transaction<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        const result = await this.transactionContext.run(true, operation);
        this.connection.exec("COMMIT");
        return result;
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    });
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const versionRow = this.connection.prepare("PRAGMA user_version").get() as { user_version: number | bigint };
    const version = Number(versionRow.user_version);
    if (version < 1) {
      this.migrateTransaction(() => {
        this.connection.exec(`
        CREATE TABLE codex_sessions (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL UNIQUE,
          cwd TEXT NOT NULL,
          model TEXT,
          title TEXT,
          status TEXT NOT NULL CHECK(status IN ('observed','running','ready','summarized','ignored')),
          last_event_at TEXT NOT NULL,
          last_completed_turn_id TEXT,
          summarized_at TEXT,
          ignored_at TEXT,
          sort_at TEXT NOT NULL
        );
        CREATE INDEX idx_codex_sessions_queue ON codex_sessions(status, sort_at DESC);

        CREATE TABLE codex_turns (
          id TEXT NOT NULL,
          session_id TEXT NOT NULL REFERENCES codex_sessions(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
          prompt_preview TEXT NOT NULL,
          assistant_preview TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          PRIMARY KEY(session_id, id),
          UNIQUE(session_id, sequence)
        );

        CREATE TABLE hook_events (
          deduplication_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          turn_id TEXT,
          event_type TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL
        );

        CREATE TABLE summary_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK(kind IN ('template','systemPrompt')),
          instructions TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE summary_documents (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES codex_sessions(id) ON DELETE CASCADE,
          profile_id TEXT NOT NULL REFERENCES summary_profiles(id),
          selected_turn_ids_json TEXT NOT NULL,
          current_version_id TEXT,
          notes_account TEXT,
          notes_folder TEXT,
          publication_status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_summary_documents_session ON summary_documents(session_id, updated_at DESC);

        CREATE TABLE summary_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES summary_documents(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('agent-draft','edited-draft','final')),
          title TEXT NOT NULL,
          abstract TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          source_turn_ids_json TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          model TEXT,
          output_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(document_id, sequence)
        );

        CREATE TABLE summary_jobs (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL REFERENCES summary_documents(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','canceled')),
          error TEXT,
          covered_turn_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE notes_exports (
          document_id TEXT PRIMARY KEY REFERENCES summary_documents(id) ON DELETE CASCADE,
          publisher TEXT NOT NULL,
          external_id TEXT,
          account TEXT,
          folder TEXT NOT NULL,
          version_id TEXT NOT NULL REFERENCES summary_versions(id),
          status TEXT NOT NULL CHECK(status IN ('pending','published','failed')),
          error TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE outbox (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('domain-event','notes-sync')),
          aggregate_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          processed_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        CREATE INDEX idx_outbox_pending ON outbox(kind, processed_at, created_at);

        CREATE TABLE application_settings (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE summary_fts USING fts5(
          document_id UNINDEXED,
          title,
          abstract,
          body_markdown,
          tags,
          cwd,
          tokenize='unicode61'
        );
        `);
        const now = new Date().toISOString();
        this.connection.prepare(`
        INSERT INTO summary_profiles(id, name, kind, instructions, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(
          "builtin-task-retrospective",
          "任务复盘",
          "template",
          "# {{title}}\n\n## 目标\n\n## 完成内容\n\n## 关键决策\n\n## 文件与命令\n\n## 问题与解决\n\n## 后续事项\n\n保持以上 Markdown 结构，以事实为准，不臆测。",
          now,
          now,
        );
        this.connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(now);
        this.connection.exec("PRAGMA user_version = 1");
      });
    }
    if (version < 2) {
      this.migrateTransaction(() => {
        this.connection.exec("ALTER TABLE summary_jobs ADD COLUMN stage_coverage_json TEXT NOT NULL DEFAULT '[]'");
        const now = new Date().toISOString();
        this.connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)").run(now);
        this.connection.exec("PRAGMA user_version = 2");
      });
    }
    if (version < 3) {
      this.migrateTransaction(() => {
        this.connection.exec("ALTER TABLE codex_turns RENAME COLUMN prompt_preview TO prompt_content");
        this.connection.exec("ALTER TABLE codex_turns RENAME COLUMN assistant_preview TO assistant_content");
        const now = new Date().toISOString();
        this.connection.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)").run(now);
        this.connection.exec("PRAGMA user_version = 3");
      });
    }
  }

  private migrateTransaction(operation: () => void): void {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}
