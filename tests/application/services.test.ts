import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeSqliteSynapseDatabase } from "@infrastructure/sqlite/database";
import { SqliteCodexSessionRepository, SqliteCodexTurnRepository, SqliteHookEventRepository, SqliteOutboxRepository, SqlitePublicationRepository, SqliteSummaryDocumentRepository, SqliteSummaryJobRepository, SqliteSummaryProfileRepository } from "@infrastructure/sqlite/repositories";
import { SqliteUnitOfWork } from "@infrastructure/sqlite/unit-of-work";
import { ArbitraryTurnSelectionService, DefaultSessionLifecycleService, NormalizedTurnSummaryContextService } from "@domain/services";
import { HookBasedSessionAwarenessService } from "@application/session-services";
import { DestinationAwareSummaryGenerationService, OutboxSummaryPublicationService, TransactionalSummaryDeletionService, VersionedSummaryFinalizationService } from "@application/summary-services";
import { CodexSessionAggregate } from "@domain/session";
import { AppleNotesPublicationTarget, NotionPublicationTarget, SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";
import { PublicationOutboxWorker } from "@infrastructure/publication/outbox-worker";
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

  it("publishes summary job state changes and rejects concurrent generation for one session", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
      session.startTurn({ turnId: "turn", promptContent: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "c" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const profile = (await profiles.list())[0]!;
      let releaseAgent: () => void = () => undefined; let markAgentStarted: () => void = () => undefined;
      const agentStarted = new Promise<void>((resolveStarted) => { markAgentStarted = resolveStarted; });
      let id = 0; let changes = 0;
      const service = new DestinationAwareSummaryGenerationService(
        new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
        { async generate() { await new Promise<void>((resolveAgent) => { releaseAgent = resolveAgent; markAgentStarted(); }); return { title: "Title", abstract: "", bodyMarkdown: "Body", tags: [], model: null, stages: [{ kind: "final", turnIds: ["turn"] }] }; }, async cancel() {}, async listModels() { return []; } },
        profiles, summaries, sessions, jobs, new SqliteUnitOfWork(database), { now: () => "d" }, { next: () => `job-state-${++id}` }, () => { changes += 1; },
      );
      const command = { sessionId: "session", selectedTurnIds: ["turn"], model: null, destination: { kind: "new" as const, profileId: profile.id, publicationTarget: null } };
      const generation = service.generateDraft(command);
      await agentStarted;

      expect((await jobs.findActiveBySessionId("session"))?.status).toBe("running");
      expect(changes).toBe(1);
      await expect(service.generateDraft(command)).rejects.toMatchObject({ code: "SUMMARY_ALREADY_RUNNING" });

      releaseAgent();
      await generation;
      expect(await jobs.findActiveBySessionId("session")).toBeNull();
      expect(changes).toBe(2);
    } finally { database.close(); }
  });

  it("creates an immutable final, summarizes the source session, and enqueues Notes after the transaction", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const outbox = new SqliteOutboxRepository(database); const publications = new SqlitePublicationRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a"); session.startTurn({ turnId: "turn", promptContent: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "c" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: new AppleNotesPublicationTarget(null, "Synapse"), createdAt: "d", updatedAt: "d" });
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, baseVersionId: null, content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision("session", ["turn"], "hash"), model: null, createdAt: "e" }));
      await summaries.create(document);
      let id = 0;
      const service = new VersionedSummaryFinalizationService(summaries, sessions, outbox, publications, new SqliteUnitOfWork(database), { now: () => "2026-01-01T00:00:00.000Z" }, { next: () => `final-id-${++id}` });
      const edited = await service.updateDraft({ documentId: "doc", expectedVersionId: "draft", content: { title: "Edited", abstract: "Abstract", bodyMarkdown: "Edited body", tags: ["tag"] } });
      expect((await summaries.findById("doc"))?.currentVersion?.props).toMatchObject({ id: edited.versionId, operation: "manual-edit", parentVersionId: "draft" });
      const final = await service.finalize({ documentId: "doc", expectedVersionId: edited.versionId, content: { title: "Edited", abstract: "Abstract", bodyMarkdown: "Final", tags: ["tag"] } });
      expect(final.isFinal).toBe(true);
      expect(final.props).toMatchObject({ operation: "finalize", parentVersionId: edited.versionId });
      expect((await summaries.findById("doc"))?.snapshot.versions).toHaveLength(3);
      expect((await sessions.findById("session"))?.status).toBe("summarized");
      expect(await outbox.listPending("publication-sync", 10)).toHaveLength(1);
    } finally { database.close(); }
  });

  it("merges another session into an existing document and updates its bound Note only after final", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database);
      const outbox = new SqliteOutboxRepository(database); const publications = new SqlitePublicationRepository(database); const unitOfWork = new SqliteUnitOfWork(database);
      const owner = CodexSessionAggregate.create("owner", "owner-thread", "/knowledge", "a");
      owner.startTurn({ turnId: "owner-turn", promptContent: "base", at: "b" }); owner.completeTurn({ turnId: "owner-turn", assistantContent: "base done", at: "c" }); owner.markSummarized("d");
      const source = CodexSessionAggregate.create("source", "source-thread", "/project", "a");
      source.startTurn({ turnId: "source-turn", promptContent: "new work", at: "b" }); source.completeTurn({ turnId: "source-turn", assistantContent: "verified result", at: "c" });
      await sessions.save(owner); await sessions.save(source); await turns.saveMany(owner.id, owner.turns); await turns.saveMany(source.id, source.turns);
      const target = new AppleNotesPublicationTarget(null, "Synapse");
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: owner.id, profileId: "builtin-task-retrospective", selection: new TurnSelection(["owner-turn"]), publicationTarget: target, createdAt: "d", updatedAt: "d" });
      const base = new SummaryVersion({ id: "base", documentId: "doc", sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Knowledge", abstract: "", bodyMarkdown: "# Knowledge\n\n## Existing\n\nKeep.", tags: [] }, sourceRevision: new SourceRevision(owner.id, ["owner-turn"], "base-hash"), model: null, createdAt: "e" });
      document.finalize(base, false); await summaries.create(document);
      await publications.save({ documentId: "doc", publisher: "apple-notes", externalId: "note-1", target, versionId: "base", status: "published", error: null, updatedAt: "e" });
      let captured: Record<string, unknown> | null = null; let id = 0;
      const generation = new DestinationAwareSummaryGenerationService(
        new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
        { async generate(request) { captured = request as unknown as Record<string, unknown>; return { title: "Knowledge", abstract: "", bodyMarkdown: "# Knowledge\n\n## Existing\n\nKeep.\n\n## New\n\nVerified result.", tags: [], model: null, stages: [{ kind: "final", turnIds: ["source-turn"] }] }; }, async cancel() {}, async listModels() { return []; } },
        profiles, summaries, sessions, jobs, unitOfWork, { now: () => `time-${id}` }, { next: () => `merge-id-${++id}` }, () => undefined,
      );
      const draft = await generation.generateDraft({ sessionId: source.id, selectedTurnIds: ["source-turn"], model: null, destination: { kind: "existing", targetDocumentId: "doc" } });
      expect(captured).toMatchObject({ generationMode: "merge", target: { versionId: "base", content: { bodyMarkdown: "# Knowledge\n\n## Existing\n\nKeep." } } });
      expect(captured && "profile" in captured).toBe(false);
      const merged = await summaries.findById("doc");
      expect(merged?.currentVersion?.props).toMatchObject({ id: draft.versionId, generationMode: "merge", operation: "merge", parentVersionId: "base", baseVersionId: "base" });
      expect(await outbox.listPending("publication-sync", 10)).toHaveLength(0);

      const finalization = new VersionedSummaryFinalizationService(summaries, sessions, outbox, publications, unitOfWork, { now: () => "final-time" }, { next: () => `final-${++id}` });
      await finalization.finalize({ documentId: "doc", expectedVersionId: draft.versionId, content: draft.content });
      expect((await sessions.findById(source.id))?.status).toBe("summarized");
      expect((await summaries.findLatestBySessionId(source.id))?.id).toBe("doc");
      expect(await outbox.listPending("publication-sync", 10)).toHaveLength(1);
    } finally { database.close(); }
  });

  it("locks a merge target and refuses to overwrite a version changed while the agent runs", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database); const unitOfWork = new SqliteUnitOfWork(database);
      const owner = CodexSessionAggregate.create("owner", "owner-thread", "/repo", "a"); owner.startTurn({ turnId: "owner-turn", promptContent: "base", at: "b" }); owner.completeTurn({ turnId: "owner-turn", assistantContent: "base", at: "c" });
      const first = CodexSessionAggregate.create("first", "first-thread", "/repo", "a"); first.startTurn({ turnId: "first-turn", promptContent: "first", at: "b" }); first.completeTurn({ turnId: "first-turn", assistantContent: "first done", at: "c" });
      const second = CodexSessionAggregate.create("second", "second-thread", "/repo", "a"); second.startTurn({ turnId: "second-turn", promptContent: "second", at: "b" }); second.completeTurn({ turnId: "second-turn", assistantContent: "second done", at: "c" });
      for (const session of [owner, first, second]) { await sessions.save(session); await turns.saveMany(session.id, session.turns); }
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: owner.id, profileId: "builtin-task-retrospective", selection: new TurnSelection(["owner-turn"]), publicationTarget: null, createdAt: "d", updatedAt: "d" });
      const baseRevision = new SourceRevision(owner.id, ["owner-turn"], "base-hash");
      document.finalize(new SummaryVersion({ id: "base", documentId: "doc", sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Base", abstract: "", bodyMarkdown: "Base", tags: [] }, sourceRevision: baseRevision, model: null, createdAt: "e" }), false);
      await summaries.create(document);
      let started!: () => void; const agentStarted = new Promise<void>((resolve) => { started = resolve; });
      let release!: () => void; const service = new DestinationAwareSummaryGenerationService(
        new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
        { async generate() { started(); await new Promise<void>((resolve) => { release = resolve; }); return { title: "Merged", abstract: "", bodyMarkdown: "Merged", tags: [], model: null, stages: [{ kind: "final", turnIds: ["first-turn"] }] }; }, async cancel() {}, async listModels() { return []; } },
        profiles, summaries, sessions, jobs, unitOfWork, { now: () => "now" }, { next: (() => { let id = 0; return () => `id-${++id}`; })() }, () => undefined,
      );
      const generation = service.generateDraft({ sessionId: first.id, selectedTurnIds: ["first-turn"], model: null, destination: { kind: "existing", targetDocumentId: "doc" } });
      await agentStarted;
      await expect(service.generateDraft({ sessionId: second.id, selectedTurnIds: ["second-turn"], model: null, destination: { kind: "existing", targetDocumentId: "doc" } })).rejects.toMatchObject({ code: "SUMMARY_TARGET_BUSY" });
      const changed = await summaries.findById("doc");
      changed!.addDraft(new SummaryVersion({ id: "manual", documentId: "doc", sequence: 1, kind: "edited-draft", generationMode: "new", operation: "manual-edit", parentVersionId: "base", baseVersionId: null, content: { title: "Manual", abstract: "", bodyMarkdown: "Manual", tags: [] }, sourceRevision: baseRevision, model: null, createdAt: "later" }));
      await summaries.save(changed!);
      release();
      await expect(generation).rejects.toMatchObject({ code: "SUMMARY_TARGET_CHANGED" });
      expect((await summaries.findById("doc"))?.currentVersion?.props.id).toBe("manual");
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
      const revision = new SourceRevision("session", ["turn"], "hash");
      document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, baseVersionId: null, content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: revision, model: null, createdAt: "e" }));
      document.finalize(new SummaryVersion({ id: "final", documentId: "doc", sequence: 1, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: "draft", baseVersionId: null, content: { title: "Title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, sourceRevision: revision, model: null, createdAt: "f" }), false);
      await summaries.create(document);
      await jobs.save({ id: "job", documentId: "doc", sourceSessionId: "session", generationMode: "new", baseVersionId: null, status: "succeeded", error: null, coveredTurnIds: ["turn"], stageCoverage: [], createdAt: "e", updatedAt: "e" });
      await outbox.add({ id: "message", kind: "publication-sync", aggregateId: "doc", payload: {}, createdAt: "e", processedAt: null, attempts: 0, lastError: null });
      database.connection.prepare("INSERT INTO publications(document_id,publisher,external_id,target_json,version_id,status,error,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("doc", "apple-notes", "note", JSON.stringify({ kind: "apple-notes", account: null, folder: "Synapse" }), "final", "published", null, "e");

      const service = new TransactionalSummaryDeletionService(summaries, sessions, outbox, new SqliteUnitOfWork(database));
      await service.delete("doc");

      expect(await summaries.findById("doc")).toBeNull();
      expect((await sessions.findById("session"))?.snapshot).toMatchObject({ status: "ready", summarizedAt: null });
      for (const table of ["summary_versions", "summary_jobs", "publications", "summary_fts", "outbox"]) {
        expect((database.connection.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count).toBe(0);
      }
      await expect(summaries.save(document)).rejects.toThrow("Summary document does not exist.");
      expect(await summaries.findById("doc")).toBeNull();
    } finally { database.close(); }
  });

  it("reopens only source sessions that no longer have another final after deleting a cumulative document", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const outbox = new SqliteOutboxRepository(database);
      const first = CodexSessionAggregate.create("first", "first-thread", "/repo", "a"); first.startTurn({ turnId: "first-turn", promptContent: "first", at: "a" }); first.completeTurn({ turnId: "first-turn", assistantContent: "done", at: "b" }); first.markSummarized("b");
      const shared = CodexSessionAggregate.create("shared", "shared-thread", "/repo", "a"); shared.startTurn({ turnId: "shared-turn", promptContent: "shared", at: "a" }); shared.completeTurn({ turnId: "shared-turn", assistantContent: "done", at: "b" }); shared.markSummarized("b");
      await sessions.save(first); await sessions.save(shared); await turns.saveMany(first.id, first.turns); await turns.saveMany(shared.id, shared.turns);
      const cumulative = SummaryDocumentAggregate.create({ id: "cumulative", sessionId: first.id, profileId: "builtin-task-retrospective", selection: new TurnSelection(["first-turn"]), publicationTarget: null, createdAt: "c", updatedAt: "c" });
      cumulative.finalize(new SummaryVersion({ id: "first-final", documentId: cumulative.id, sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Cumulative", abstract: "", bodyMarkdown: "First", tags: [] }, sourceRevision: new SourceRevision(first.id, ["first-turn"], "first-hash"), model: null, createdAt: "d" }), false);
      cumulative.finalize(new SummaryVersion({ id: "shared-final", documentId: cumulative.id, sequence: 1, kind: "final", generationMode: "merge", operation: "finalize", parentVersionId: "first-final", baseVersionId: "first-final", content: { title: "Cumulative", abstract: "", bodyMarkdown: "First and shared", tags: [] }, sourceRevision: new SourceRevision(shared.id, ["shared-turn"], "shared-hash"), model: null, createdAt: "e" }), false);
      await summaries.create(cumulative);
      const retained = SummaryDocumentAggregate.create({ id: "retained", sessionId: shared.id, profileId: "builtin-task-retrospective", selection: new TurnSelection(["shared-turn"]), publicationTarget: null, createdAt: "c", updatedAt: "c" });
      retained.finalize(new SummaryVersion({ id: "retained-final", documentId: retained.id, sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Retained", abstract: "", bodyMarkdown: "Shared", tags: [] }, sourceRevision: new SourceRevision(shared.id, ["shared-turn"], "shared-hash"), model: null, createdAt: "d" }), false);
      await summaries.create(retained);

      await new TransactionalSummaryDeletionService(summaries, sessions, outbox, new SqliteUnitOfWork(database)).delete(cumulative.id);
      expect((await sessions.findById(first.id))?.status).toBe("ready");
      expect((await sessions.findById(shared.id))?.status).toBe("summarized");
    } finally { database.close(); }
  });

  it("attempts a failed Notes outbox message once until the user explicitly retries", async () => {
    const { database } = await testDatabase();
    try {
      const outbox = new SqliteOutboxRepository(database);
      await outbox.add({ id: "message", kind: "publication-sync", aggregateId: "doc", payload: {}, createdAt: "a", processedAt: null, attempts: 0, lastError: null });
      let attempts = 0;
      const worker = new PublicationOutboxWorker(outbox, { async publishCurrent() { attempts += 1; throw new Error("permission denied"); }, async retry() {} }, { now: () => "now" }, logger);
      await worker.runOnce(); await worker.runOnce();
      expect(attempts).toBe(1);
      const row = database.connection.prepare("SELECT attempts,last_error FROM outbox WHERE id = ?").get("message") as { attempts: number; last_error: string };
      expect(row).toEqual({ attempts: 1, last_error: "permission denied" });
    } finally { database.close(); }
  });

  it("routes a Notion target to the Notion publisher and persists its page id", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const summaries = new SqliteSummaryDocumentRepository(database); const publications = new SqlitePublicationRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
      session.startTurn({ turnId: "turn", promptContent: "prompt", at: "a" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "b" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const target = new NotionPublicationTarget("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: session.id, profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn"]), publicationTarget: target, createdAt: "b", updatedAt: "b" });
      document.finalize(new SummaryVersion({ id: "final", documentId: document.id, sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Title", abstract: "", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision(session.id, ["turn"], "hash"), model: null, createdAt: "c" }), true);
      await summaries.create(document);
      let published = false;
      const publisher = { kind: "notion" as const, async publish() { published = true; return { externalId: "notion-page", updated: false }; } };
      const service = new OutboxSummaryPublicationService(summaries, publications, { get(kind) { expect(kind).toBe("notion"); return publisher; } }, { now: () => "d" });

      await service.publishCurrent(document.id);

      expect(published).toBe(true);
      expect(await publications.find(document.id)).toMatchObject({ publisher: "notion", externalId: "notion-page", target: { kind: "notion" } });
    } finally { database.close(); }
  });

  it("regenerates from the current version source metadata", async () => {
    const { database } = await testDatabase();
    try {
      const sessions = new SqliteCodexSessionRepository(database); const turns = new SqliteCodexTurnRepository(database);
      const profiles = new SqliteSummaryProfileRepository(database); const summaries = new SqliteSummaryDocumentRepository(database); const jobs = new SqliteSummaryJobRepository(database);
      const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
      session.startTurn({ turnId: "turn-1", promptContent: "one", at: "b" }); session.completeTurn({ turnId: "turn-1", assistantContent: "done-one", at: "c" });
      session.startTurn({ turnId: "turn-2", promptContent: "two", at: "d" }); session.completeTurn({ turnId: "turn-2", assistantContent: "done-two", at: "e" });
      await sessions.save(session); await turns.saveMany(session.id, session.turns);
      const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "builtin-task-retrospective", selection: new TurnSelection(["turn-1"]), publicationTarget: null, createdAt: "f", updatedAt: "f" });
      document.addDraft(new SummaryVersion({ id: "current", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, baseVersionId: null, content: { title: "Old", abstract: "", bodyMarkdown: "Old", tags: [] }, sourceRevision: new SourceRevision("session", ["turn-2"], "hash"), model: null, createdAt: "f" }));
      await summaries.create(document);
      let id = 0;
      let source = "";
      const service = new DestinationAwareSummaryGenerationService(
        new ArbitraryTurnSelectionService(), new NormalizedTurnSummaryContextService(new NodeContentHashService()),
        { async generate(request) { source = request.context.chunks[0]?.content ?? ""; return { title: "New", abstract: "", bodyMarkdown: "Body", tags: [], model: null, stages: [{ kind: "final", turnIds: ["turn-2"] }] }; }, async cancel() {}, async listModels() { return []; } },
        profiles, summaries, sessions, jobs, new SqliteUnitOfWork(database), { now: () => "g" }, { next: () => `generated-${++id}` }, () => undefined,
      );
      await service.regenerate({ documentId: "doc", model: null });
      const saved = await summaries.findById("doc");
      expect(saved?.snapshot.profileId).toBe("builtin-task-retrospective");
      expect(saved?.currentVersion?.props.sourceRevision.turnIds).toEqual(["turn-2"]);
      expect(saved?.currentVersion?.props).toMatchObject({ operation: "regenerate", parentVersionId: "current", baseVersionId: null });
      expect(source).toContain("two");
      expect(source).toContain("done-two");
    } finally { database.close(); }
  });
});

async function testDatabase() {
  const root = await mkdtemp(join(tmpdir(), "synapse-application-")); directories.push(root);
  return { database: new NodeSqliteSynapseDatabase(join(root, "db.sqlite3"), logger) };
}
