import { describe, expect, it } from "vitest";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";

describe("SummaryDocumentAggregate", () => {
  it("keeps final versions immutable and creates a version history", () => {
    const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "profile", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "a", updatedAt: "a" });
    const sourceRevision = new SourceRevision(["turn"], "hash");
    document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", content: { title: "t", abstract: "a", bodyMarkdown: "b", tags: [] }, sourceRevision, model: null, createdAt: "b" }));
    document.finalize(new SummaryVersion({ id: "final", documentId: "doc", sequence: 1, kind: "final", content: { title: "t", abstract: "a", bodyMarkdown: "final", tags: [] }, sourceRevision, model: null, createdAt: "c" }), false);
    expect(document.currentVersion?.props.id).toBe("final");
    expect(document.snapshot.versions).toHaveLength(2);
    expect(Object.isFrozen(document.currentVersion?.props)).toBe(true);
    expect(Object.isFrozen(document.currentVersion?.props.content)).toBe(true);
    expect(() => document.finalize(document.currentVersion!, false)).toThrowError(/cannot be replaced/);
  });
});
