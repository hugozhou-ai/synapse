import { describe, expect, it } from "vitest";
import { NormalizedTurnSummaryContextService, type ContentHashService } from "@domain/services";
import { TurnSelection } from "@domain/summary";

const hasher: ContentHashService = { sha256: async (content) => `hash:${content.length}` };

describe("NormalizedTurnSummaryContextService", () => {
  it("excludes reasoning upstream, limits command output, and chunks at turn boundaries", async () => {
    const service = new NormalizedTurnSummaryContextService(hasher, 90, 12);
    const context = await service.build({ threadId: "thread", turns: [
      { id: "a", sequence: 0, status: "completed", startedAt: "x", completedAt: "y", items: [{ type: "user", text: "first prompt" }, { type: "command", text: "12345678901234567890", status: "completed" }] },
      { id: "b", sequence: 1, status: "completed", startedAt: "x", completedAt: "y", items: [{ type: "agent", text: "second response" }] },
    ] }, new TurnSelection(["a", "b"]));
    expect(context.chunks).toHaveLength(2);
    expect(context.chunks[0]?.content).toContain("[command output omitted]");
    expect(context.sourceTurnIds).toEqual(["a", "b"]);
    expect(context.sourceHash).toMatch(/^hash:/);
  });
});
