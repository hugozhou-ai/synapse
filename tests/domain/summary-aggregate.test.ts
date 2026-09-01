import { describe, expect, it } from "vitest";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";

describe("SummaryDocumentAggregate", () => {
  it("keeps final versions immutable and creates a version history", () => {
    const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "profile", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "a", updatedAt: "a" });
    const sourceRevision = new SourceRevision("session", ["turn"], "hash");
    document.addDraft(new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "new", baseVersionId: null, content: { title: "t", abstract: "a", bodyMarkdown: "b", tags: [] }, sourceRevision, model: null, createdAt: "b" }));
    document.finalize(new SummaryVersion({ id: "final", documentId: "doc", sequence: 1, kind: "final", generationMode: "new", baseVersionId: null, content: { title: "t", abstract: "a", bodyMarkdown: "final", tags: [] }, sourceRevision, model: null, createdAt: "c" }), false);
    expect(document.currentVersion?.props.id).toBe("final");
    expect(document.snapshot.versions).toHaveLength(2);
    expect(Object.isFrozen(document.currentVersion?.props)).toBe(true);
    expect(Object.isFrozen(document.currentVersion?.props.content)).toBe(true);
    expect(() => document.finalize(document.currentVersion!, false)).toThrowError(/cannot be replaced/);
  });

  it("keeps merge provenance on the appended draft", () => {
    const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "old-profile", selection: new TurnSelection(["turn-1"]), publicationTarget: null, createdAt: "a", updatedAt: "a" });
    const draft = new SummaryVersion({ id: "draft", documentId: "doc", sequence: 0, kind: "agent-draft", generationMode: "merge", baseVersionId: "base", content: { title: "t", abstract: "a", bodyMarkdown: "b", tags: [] }, sourceRevision: new SourceRevision("session-2", ["turn-2"], "new-hash"), model: null, createdAt: "b" });
    document.addDraft(draft);
    expect(document.snapshot.profileId).toBe("old-profile");
    expect(document.snapshot.selection.turnIds).toEqual(["turn-1"]);
    expect(document.currentVersion?.props.generationMode).toBe("merge");
    expect(document.currentVersion?.props.baseVersionId).toBe("base");
    expect(document.currentVersion?.props.sourceRevision.turnIds).toEqual(["turn-2"]);
  });
});
