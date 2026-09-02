import { describe, expect, it, vi } from "vitest";
import { SourceRevision, SummaryDocumentAggregate, SummaryVersion, TurnSelection } from "@domain/summary";
import { RepositorySummaryReferenceService, formatSummaryReference } from "@application/summary-reference";
import type { SummaryDocumentRepository, TextClipboardGateway } from "@application/ports";

describe("summary references", () => {
  it("formats a compact immutable reference and sanitizes its label", () => {
    expect(formatSummaryReference("doc", "version", "A | [title]\nnext")).toEqual({
      uri: "synapse://summary/doc?v=version",
      text: "[[Synapse:A title next|synapse://summary/doc?v=version]]",
    });
  });

  it("copies the current version reference without copying summary content", async () => {
    const document = SummaryDocumentAggregate.create({ id: "doc", sessionId: "session", profileId: "profile", selection: new TurnSelection(["turn"]), publicationTarget: null, createdAt: "a", updatedAt: "a" });
    document.finalize(new SummaryVersion({ id: "version", documentId: "doc", sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, baseVersionId: null, content: { title: "Decision", abstract: "private abstract", bodyMarkdown: "private body", tags: [] }, sourceRevision: new SourceRevision("session", ["turn"], "hash"), model: null, createdAt: "b" }), false);
    const summaries = { findById: vi.fn().mockResolvedValue(document) } as unknown as SummaryDocumentRepository;
    const clipboard: TextClipboardGateway = { writeText: vi.fn() };
    const service = new RepositorySummaryReferenceService(summaries, clipboard);

    const reference = await service.copy("doc", "version");

    expect(reference.text).toBe("[[Synapse:Decision|synapse://summary/doc?v=version]]");
    expect(reference.text).not.toContain("private");
    expect(clipboard.writeText).toHaveBeenCalledWith(reference.text);
    await expect(service.copy("doc", "missing-version")).rejects.toMatchObject({ code: "SUMMARY_VERSION_NOT_FOUND" });
  });
});
