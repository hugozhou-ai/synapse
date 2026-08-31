import { CodexSessionAggregate, CodexTurn, type CodexLifecycleEvent, type CodexSessionProps, type SessionStatus, type TurnStatus } from "@domain/session";
import { PublicationTarget, SourceRevision, SummaryDocumentAggregate, SummaryProfile, SummaryVersion, TurnSelection, type PublicationStatus, type SummaryProfileKind, type SummaryVersionKind } from "@domain/summary";
import type {
  ApplicationSettings, CodexSessionRepository, CodexTurnRepository, HookEventRepository, OutboxMessage, OutboxRepository,
  PublicationRecord, PublicationRepository, SettingsRepository, SummaryDocumentRepository, SummaryJob, SummaryJobRepository,
  SummaryProfileRepository, SummarySearchCriteria, SummarySearchResult,
} from "@application/ports";
import type { SynapseDatabase } from "./database";

type Row = Record<string, unknown>;

const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class SqliteCodexSessionRepository implements CodexSessionRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async findById(id: string): Promise<CodexSessionAggregate | null> { return this.db.execute(() => this.find("id = ?", id)); }
  async findByThreadId(threadId: string): Promise<CodexSessionAggregate | null> { return this.db.execute(() => this.find("thread_id = ?", threadId)); }

  async save(session: CodexSessionAggregate): Promise<void> {
    await this.db.execute(() => {
      const p = session.snapshot;
      this.db.connection.prepare(`
      INSERT INTO codex_sessions(id,thread_id,cwd,model,title,status,last_event_at,last_completed_turn_id,summarized_at,ignored_at,sort_at)
      VALUES (@id,@threadId,@cwd,@model,@title,@status,@lastEventAt,@lastCompletedTurnId,@summarizedAt,@ignoredAt,@sortAt)
      ON CONFLICT(id) DO UPDATE SET thread_id=excluded.thread_id,cwd=excluded.cwd,model=excluded.model,title=excluded.title,
        status=excluded.status,last_event_at=excluded.last_event_at,last_completed_turn_id=excluded.last_completed_turn_id,
        summarized_at=excluded.summarized_at,ignored_at=excluded.ignored_at,sort_at=excluded.sort_at
      `).run(p);
    });
  }

  async listWidgetQueue(limit?: number): Promise<readonly CodexSessionAggregate[]> {
    return this.db.execute(() => limit === undefined
      ? this.listRows(`WHERE status IN ('observed','running','ready') ORDER BY sort_at DESC`)
      : this.listRows(`WHERE status IN ('observed','running','ready') ORDER BY sort_at DESC LIMIT ?`, limit));
  }

  async search(input: { status?: string; cwd?: string; limit: number; offset: number }): Promise<readonly CodexSessionAggregate[]> {
    return this.db.execute(() => {
      const clauses: string[] = []; const values: unknown[] = [];
      if (input.status) { clauses.push("status = ?"); values.push(input.status); }
      if (input.cwd) { clauses.push("cwd = ?"); values.push(input.cwd); }
      values.push(input.limit, input.offset);
      return this.listRows(`${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY sort_at DESC LIMIT ? OFFSET ?`, ...values);
    });
  }

  private find(where: string, value: unknown): CodexSessionAggregate | null {
    const row = this.db.connection.prepare(`SELECT * FROM codex_sessions WHERE ${where}`).get(value) as Row | undefined;
    return row ? this.map(row) : null;
  }

  private listRows(suffix: string, ...values: unknown[]): readonly CodexSessionAggregate[] {
    const rows = this.db.connection.prepare(`SELECT * FROM codex_sessions ${suffix}`).all(...values) as Row[];
    return rows.map((row) => this.map(row));
  }

  private map(row: Row): CodexSessionAggregate {
    const turns = this.db.connection.prepare("SELECT * FROM codex_turns WHERE session_id = ? ORDER BY sequence").all(row.id) as Row[];
    const props: CodexSessionProps = {
      id: String(row.id), threadId: String(row.thread_id), cwd: String(row.cwd), model: row.model === null ? null : String(row.model),
      title: row.title === null ? null : String(row.title), status: String(row.status) as SessionStatus,
      turns: turns.map(mapTurn), lastEventAt: String(row.last_event_at),
      lastCompletedTurnId: row.last_completed_turn_id === null ? null : String(row.last_completed_turn_id),
      summarizedAt: row.summarized_at === null ? null : String(row.summarized_at),
      ignoredAt: row.ignored_at === null ? null : String(row.ignored_at), sortAt: String(row.sort_at),
    };
    return new CodexSessionAggregate(props);
  }
}

function mapTurn(row: Row): CodexTurn {
  return new CodexTurn({
    id: String(row.id), sequence: Number(row.sequence), status: String(row.status) as TurnStatus,
    promptPreview: String(row.prompt_preview), assistantPreview: String(row.assistant_preview),
    startedAt: String(row.started_at), completedAt: row.completed_at === null ? null : String(row.completed_at),
  });
}

export class SqliteCodexTurnRepository implements CodexTurnRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async saveMany(sessionId: string, turns: readonly CodexTurn[]): Promise<void> {
    await this.db.execute(() => {
      const statement = this.db.connection.prepare(`
      INSERT INTO codex_turns(id,session_id,sequence,status,prompt_preview,assistant_preview,started_at,completed_at)
      VALUES (@id,@sessionId,@sequence,@status,@promptPreview,@assistantPreview,@startedAt,@completedAt)
      ON CONFLICT(session_id,id) DO UPDATE SET sequence=excluded.sequence,status=excluded.status,prompt_preview=excluded.prompt_preview,
        assistant_preview=excluded.assistant_preview,started_at=excluded.started_at,completed_at=excluded.completed_at
    `);
      for (const turn of turns) statement.run({ ...turn.props, sessionId });
    });
  }
  async listBySessionId(sessionId: string): Promise<readonly CodexTurn[]> {
    return this.db.execute(() => (this.db.connection.prepare("SELECT * FROM codex_turns WHERE session_id = ? ORDER BY sequence").all(sessionId) as Row[]).map(mapTurn));
  }
}

export class SqliteHookEventRepository implements HookEventRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async exists(key: string): Promise<boolean> { return this.db.execute(() => this.db.connection.prepare("SELECT 1 FROM hook_events WHERE deduplication_key = ?").get(key) !== undefined); }
  async add(input: { deduplicationKey: string; event: CodexLifecycleEvent; receivedAt: string }): Promise<void> {
    await this.db.execute(() => {
      this.db.connection.prepare(`INSERT INTO hook_events(deduplication_key,session_id,turn_id,event_type,payload_hash,occurred_at,received_at) VALUES (?,?,?,?,?,?,?)`)
        .run(input.deduplicationKey, input.event.sessionId, input.event.turnId, input.event.eventType, input.event.payloadHash, input.event.occurredAt, input.receivedAt);
    });
  }
}

export class SqliteSummaryProfileRepository implements SummaryProfileRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async findById(id: string): Promise<SummaryProfile | null> {
    return this.db.execute(() => {
      const row = this.db.connection.prepare("SELECT * FROM summary_profiles WHERE id = ?").get(id) as Row | undefined;
      return row ? mapProfile(row) : null;
    });
  }
  async list(): Promise<readonly SummaryProfile[]> {
    return this.db.execute(() => (this.db.connection.prepare("SELECT * FROM summary_profiles ORDER BY is_default DESC, name").all() as Row[]).map(mapProfile));
  }
  async save(profile: SummaryProfile): Promise<void> {
    await this.db.execute(() => {
      const now = new Date().toISOString();
      if (profile.isDefault) this.db.connection.prepare("UPDATE summary_profiles SET is_default = 0").run();
      this.db.connection.prepare(`INSERT INTO summary_profiles(id,name,kind,instructions,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,instructions=excluded.instructions,is_default=excluded.is_default,updated_at=excluded.updated_at`)
        .run(profile.id, profile.name, profile.kind, profile.instructions, profile.isDefault ? 1 : 0, now, now);
    });
  }
  async delete(id: string): Promise<void> { await this.db.execute(() => { this.db.connection.prepare("DELETE FROM summary_profiles WHERE id = ? AND id != 'builtin-task-retrospective'").run(id); }); }
}

function mapProfile(row: Row): SummaryProfile {
  return new SummaryProfile(String(row.id), String(row.name), String(row.kind) as SummaryProfileKind, String(row.instructions), Boolean(row.is_default));
}

export class SqliteSummaryDocumentRepository implements SummaryDocumentRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async findById(id: string): Promise<SummaryDocumentAggregate | null> { return this.db.execute(() => this.find("d.id = ?", id)); }
  async findLatestBySessionId(id: string): Promise<SummaryDocumentAggregate | null> { return this.db.execute(() => this.find("d.session_id = ? ORDER BY d.updated_at DESC", id)); }

  async save(document: SummaryDocumentAggregate): Promise<void> {
    await this.db.execute(() => {
      const p = document.snapshot;
      this.db.connection.prepare(`
      INSERT INTO summary_documents(id,session_id,profile_id,selected_turn_ids_json,current_version_id,notes_account,notes_folder,publication_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,selected_turn_ids_json=excluded.selected_turn_ids_json,
        current_version_id=excluded.current_version_id,notes_account=excluded.notes_account,notes_folder=excluded.notes_folder,
        publication_status=excluded.publication_status,updated_at=excluded.updated_at
      `).run(p.id, p.sessionId, p.profileId, JSON.stringify(p.selection.turnIds), p.currentVersionId, p.publicationTarget?.account ?? null, p.publicationTarget?.folder ?? null, p.publicationStatus, p.createdAt, p.updatedAt);
      const insertVersion = this.db.connection.prepare(`
      INSERT OR IGNORE INTO summary_versions(id,document_id,sequence,kind,title,abstract,body_markdown,tags_json,source_turn_ids_json,source_hash,model,output_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      for (const version of p.versions) {
        const v = version.props;
        insertVersion.run(v.id, v.documentId, v.sequence, v.kind, v.content.title, v.content.abstract, v.content.bodyMarkdown,
          JSON.stringify(v.content.tags), JSON.stringify(v.sourceRevision.turnIds), v.sourceRevision.contentHash, v.model, JSON.stringify(v.content), v.createdAt);
      }
      if (p.currentVersionId) this.refreshFts(document);
    });
  }

  async search(input: SummarySearchCriteria): Promise<SummarySearchResult> {
    return this.db.execute(() => {
      const clauses: string[] = ["d.current_version_id = v.id"]; const args: unknown[] = [];
      let from = "summary_documents d JOIN summary_versions v ON v.document_id=d.id JOIN codex_sessions s ON s.id=d.session_id";
      if (input.text?.trim()) { from += " JOIN summary_fts f ON f.document_id=d.id"; clauses.push("summary_fts MATCH ?"); args.push(toFtsQuery(input.text)); }
      if (input.cwd) { clauses.push("s.cwd = ?"); args.push(input.cwd); }
      if (input.profileId) { clauses.push("d.profile_id = ?"); args.push(input.profileId); }
      if (input.status) { clauses.push("v.kind = ?"); args.push(input.status); }
      if (input.from) { clauses.push("d.updated_at >= ?"); args.push(input.from); }
      if (input.to) { clauses.push("d.updated_at <= ?"); args.push(input.to); }
      const where = `WHERE ${clauses.join(" AND ")}`;
      const total = Number((this.db.connection.prepare(`SELECT COUNT(*) count FROM ${from} ${where}`).get(...args) as Row).count);
      const rows = this.db.connection.prepare(`SELECT d.id document_id,d.session_id,d.profile_id,d.updated_at,v.title,v.abstract,v.tags_json,v.kind,s.cwd FROM ${from} ${where} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`)
        .all(...args, input.limit, input.offset) as Row[];
      return { total, items: rows.map((row) => ({
        documentId: String(row.document_id), sessionId: String(row.session_id), title: String(row.title), abstract: String(row.abstract),
        tags: parseJson<string[]>(row.tags_json), cwd: String(row.cwd), profileId: String(row.profile_id), versionKind: String(row.kind), updatedAt: String(row.updated_at),
      })) };
    });
  }

  private find(where: string, value: unknown): SummaryDocumentAggregate | null {
    const row = this.db.connection.prepare(`SELECT d.* FROM summary_documents d WHERE ${where} LIMIT 1`).get(value) as Row | undefined;
    if (!row) return null;
    const versions = (this.db.connection.prepare("SELECT * FROM summary_versions WHERE document_id = ? ORDER BY sequence").all(row.id) as Row[]).map(mapVersion);
    return new SummaryDocumentAggregate({
      id: String(row.id), sessionId: String(row.session_id), profileId: String(row.profile_id),
      selection: new TurnSelection(parseJson<string[]>(row.selected_turn_ids_json)), versions,
      currentVersionId: row.current_version_id === null ? null : String(row.current_version_id),
      publicationTarget: row.notes_folder === null ? null : new PublicationTarget(row.notes_account === null ? null : String(row.notes_account), String(row.notes_folder)),
      publicationStatus: String(row.publication_status) as PublicationStatus,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    });
  }

  private refreshFts(document: SummaryDocumentAggregate): void {
    const current = document.currentVersion; if (!current) return;
    const cwdRow = this.db.connection.prepare("SELECT cwd FROM codex_sessions WHERE id = ?").get(document.snapshot.sessionId) as Row;
    this.db.connection.prepare("DELETE FROM summary_fts WHERE document_id = ?").run(document.id);
    this.db.connection.prepare("INSERT INTO summary_fts(document_id,title,abstract,body_markdown,tags,cwd) VALUES (?,?,?,?,?,?)")
      .run(document.id, current.props.content.title, current.props.content.abstract, current.props.content.bodyMarkdown, current.props.content.tags.join(" "), String(cwdRow.cwd));
  }
}

function toFtsQuery(input: string): string {
  return input.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

function mapVersion(row: Row): SummaryVersion {
  return new SummaryVersion({
    id: String(row.id), documentId: String(row.document_id), sequence: Number(row.sequence), kind: String(row.kind) as SummaryVersionKind,
    content: { title: String(row.title), abstract: String(row.abstract), bodyMarkdown: String(row.body_markdown), tags: parseJson<string[]>(row.tags_json) },
    sourceRevision: new SourceRevision(parseJson<string[]>(row.source_turn_ids_json), String(row.source_hash)),
    model: row.model === null ? null : String(row.model), createdAt: String(row.created_at),
  });
}

export class SqliteSummaryJobRepository implements SummaryJobRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async save(job: SummaryJob): Promise<void> {
    await this.db.execute(() => {
      this.db.connection.prepare(`INSERT INTO summary_jobs(id,document_id,status,error,covered_turn_ids_json,stage_coverage_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status,error=excluded.error,covered_turn_ids_json=excluded.covered_turn_ids_json,stage_coverage_json=excluded.stage_coverage_json,updated_at=excluded.updated_at`)
        .run(job.id, job.documentId, job.status, job.error, JSON.stringify(job.coveredTurnIds), JSON.stringify(job.stageCoverage), job.createdAt, job.updatedAt);
    });
  }
  async findById(id: string): Promise<SummaryJob | null> {
    return this.db.execute(() => {
      const row = this.db.connection.prepare("SELECT * FROM summary_jobs WHERE id = ?").get(id) as Row | undefined;
      return row ? { id: String(row.id), documentId: String(row.document_id), status: String(row.status) as SummaryJob["status"], error: row.error === null ? null : String(row.error), coveredTurnIds: parseJson<string[]>(row.covered_turn_ids_json), stageCoverage: parseJson<SummaryJob["stageCoverage"]>(row.stage_coverage_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : null;
    });
  }
}

export class SqlitePublicationRepository implements PublicationRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async find(documentId: string, publisher: "apple-notes"): Promise<PublicationRecord | null> {
    return this.db.execute(() => {
      const row = this.db.connection.prepare("SELECT * FROM notes_exports WHERE document_id = ? AND publisher = ?").get(documentId, publisher) as Row | undefined;
      return row ? { documentId: String(row.document_id), publisher, externalId: row.external_id === null ? null : String(row.external_id), target: new PublicationTarget(row.account === null ? null : String(row.account), String(row.folder)), versionId: String(row.version_id), status: String(row.status) as PublicationRecord["status"], error: row.error === null ? null : String(row.error), updatedAt: String(row.updated_at) } : null;
    });
  }
  async save(record: PublicationRecord): Promise<void> {
    await this.db.execute(() => {
      this.db.connection.prepare(`INSERT INTO notes_exports(document_id,publisher,external_id,account,folder,version_id,status,error,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(document_id) DO UPDATE SET external_id=excluded.external_id,account=excluded.account,folder=excluded.folder,version_id=excluded.version_id,status=excluded.status,error=excluded.error,updated_at=excluded.updated_at`)
        .run(record.documentId, record.publisher, record.externalId, record.target.account, record.target.folder, record.versionId, record.status, record.error, record.updatedAt);
    });
  }
}

export class SqliteOutboxRepository implements OutboxRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async add(message: OutboxMessage): Promise<void> {
    await this.db.execute(() => {
      this.db.connection.prepare("INSERT INTO outbox(id,kind,aggregate_id,payload_json,created_at,processed_at,attempts,last_error) VALUES (?,?,?,?,?,?,?,?)")
        .run(message.id, message.kind, message.aggregateId, JSON.stringify(message.payload), message.createdAt, message.processedAt, message.attempts, message.lastError);
    });
  }
  async listPending(kind: OutboxMessage["kind"], limit: number): Promise<readonly OutboxMessage[]> {
    return this.db.execute(() => (this.db.connection.prepare("SELECT * FROM outbox WHERE kind = ? AND processed_at IS NULL AND attempts = 0 ORDER BY created_at LIMIT ?").all(kind, limit) as Row[]).map((row) => ({
      id: String(row.id), kind: String(row.kind) as OutboxMessage["kind"], aggregateId: String(row.aggregate_id), payload: parseJson(row.payload_json), createdAt: String(row.created_at), processedAt: null, attempts: Number(row.attempts), lastError: row.last_error === null ? null : String(row.last_error),
    })));
  }
  async markProcessed(id: string, at: string): Promise<void> { await this.db.execute(() => { this.db.connection.prepare("UPDATE outbox SET processed_at = ?, last_error = NULL WHERE id = ?").run(at, id); }); }
  async markFailed(id: string, error: string): Promise<void> { await this.db.execute(() => { this.db.connection.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?").run(error, id); }); }
  async markAggregateProcessed(kind: OutboxMessage["kind"], aggregateId: string, at: string): Promise<void> {
    await this.db.execute(() => { this.db.connection.prepare("UPDATE outbox SET processed_at = ?, last_error = NULL WHERE kind = ? AND aggregate_id = ? AND processed_at IS NULL").run(at, kind, aggregateId); });
  }
}

const defaultSettings: ApplicationSettings = {
  codexBinaryPath: null, summaryModel: null, syncNotesByDefault: false, notesAccount: null,
  notesFolder: "Synapse", widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false,
};

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SynapseDatabase) {}
  async read(): Promise<ApplicationSettings> {
    return this.db.execute(() => {
      const row = this.db.connection.prepare("SELECT value_json FROM application_settings WHERE id = 1").get() as Row | undefined;
      return row ? { ...defaultSettings, ...parseJson<Partial<ApplicationSettings>>(row.value_json) } : defaultSettings;
    });
  }
  async save(settings: ApplicationSettings): Promise<void> {
    await this.db.execute(() => {
      this.db.connection.prepare("INSERT INTO application_settings(id,value_json,updated_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at")
        .run(JSON.stringify(settings), new Date().toISOString());
    });
  }
}
