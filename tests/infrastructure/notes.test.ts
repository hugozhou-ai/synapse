import { describe, expect, it } from "vitest";
import { AppleNotesSummaryPublisher, type AppleScriptExecutor } from "@infrastructure/notes/publisher";
import { PublicationTarget, SourceRevision, SummaryVersion } from "@domain/summary";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };

describe("AppleNotesSummaryPublisher", () => {
  it("passes content through argv and updates the existing note identifier", async () => {
    let captured = "";
    const executor: AppleScriptExecutor = { async execute(_path, payload) { captured = payload; return JSON.stringify({ externalId: "note-1", updated: true }); } };
    const publisher = new AppleNotesSummaryPublisher("/fixed/script.jxa", logger, executor);
    const version = new SummaryVersion({ id: "v", documentId: "doc", sequence: 1, kind: "final", content: { title: "Title", abstract: "", bodyMarkdown: "# Title\n\nBody", tags: [] }, sourceRevision: new SourceRevision(["turn"], "hash"), model: null, createdAt: "now" });
    const receipt = await publisher.publish({ documentId: "doc", version, target: new PublicationTarget(null, "Synapse"), existingExternalId: "note-1" });
    expect(receipt).toEqual({ externalId: "note-1", updated: true });
    const payload = JSON.parse(captured) as { existingExternalId: string; folder: string; title: string; html: string };
    expect(payload).toMatchObject({ existingExternalId: "note-1", folder: "Synapse", title: "Title" });
    expect(payload.html).toContain("<h1>Title</h1>");
  });
});
