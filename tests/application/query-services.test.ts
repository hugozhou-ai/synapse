import { describe, expect, it } from "vitest";
import { RepositorySessionQueryService } from "@application/query-services";
import { CodexSessionAggregate } from "@domain/session";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";

describe("RepositorySessionQueryService", () => {
  it("serves locally persisted turns without asking App Server to load the thread", async () => {
    const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
    session.startTurn({ turnId: "turn", promptContent: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantContent: "done", at: "c" });
    const summary = SummaryDocumentAggregate.create({ id: "document", sessionId: "session", profileId: "profile", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "c", updatedAt: "c" });
    summary.addDraft(new SummaryVersion({ id: "version", documentId: "document", sequence: 0, kind: "agent-draft", generationMode: "new", baseVersionId: null, content: { title: "Title", abstract: "", bodyMarkdown: "Body", tags: [] }, sourceRevision: new SourceRevision("session", ["turn"], "hash"), model: null, createdAt: "d" }));
    const service = new RepositorySessionQueryService(
      { async findById() { return session; }, async findByThreadId() { return session; }, async save() {}, async listWidgetQueue() { return [session]; }, async search() { return [session]; } },
      { now: () => "d" },
      { async findById() { return summary; }, async findLatestBySessionId() { return summary; }, async hasFinalBySessionId() { return false; }, async create() {}, async save() {}, async delete() {}, async search() { return { total: 0, items: [] }; } },
      { async save() {}, async findById() { return null; }, async findActiveBySessionId() { return { id: "job", documentId: "document", sourceSessionId: "session", generationMode: "new" as const, baseVersionId: null, status: "running" as const, error: null, coveredTurnIds: ["turn"], stageCoverage: [], createdAt: "c", updatedAt: "c" }; }, async findActiveByDocumentId() { return null; }, async failActive() {} },
    );
    const result = await service.getConversationTurns("session");
    expect(result.turns[0]?.promptPreview).toBe("prompt");
    expect((await service.listWidgetQueue())[0]?.summaryDocumentId).toBe("document");
    expect((await service.listWidgetQueue())[0]?.summaryInProgress).toBe(true);
  });
});
