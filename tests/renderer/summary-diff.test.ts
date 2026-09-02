import { describe, expect, it } from "vitest";
import type { SummaryVersionView } from "@application/contracts";
import { contributionVersions, diffSummaryContent, emptySummaryContent } from "../../src/renderer/src/features/history/summary-diff";

describe("summary diff", () => {
  it("handles an initial version and distinguishes added, removed and modified lines", () => {
    expect(diffSummaryContent(emptySummaryContent, { ...emptySummaryContent, bodyMarkdown: "一\n二" }).stats).toEqual({ added: 2, removed: 0, modified: 0 });
    const changed = diffSummaryContent(
      { ...emptySummaryContent, bodyMarkdown: "# 标题\n保留\n删除" },
      { ...emptySummaryContent, bodyMarkdown: "# 新标题\n保留\n新增" },
    );
    expect(changed.stats).toEqual({ added: 0, removed: 0, modified: 2 });
    expect(changed.rows.filter((row) => row.kind === "modified")[0]?.newParts?.some((part) => part.changed)).toBe(true);
  });

  it("keeps code blocks and tag-only changes deterministic", () => {
    const before = { title: "T", abstract: "", bodyMarkdown: "```ts\nconst a = 1;\n```", tags: ["a", "b"] };
    const after = { title: "T", abstract: "", bodyMarkdown: "```ts\nconst a = 2;\n```", tags: ["b", "a"] };
    expect(diffSummaryContent(before, after).stats).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(diffSummaryContent(before, before).stats).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it("bounds work for large unrelated summaries", () => {
    const before = { ...emptySummaryContent, bodyMarkdown: Array.from({ length: 5_000 }, (_, index) => `old-${index}`).join("\n") };
    const after = { ...emptySummaryContent, bodyMarkdown: Array.from({ length: 5_000 }, (_, index) => `new-${index}`).join("\n") };
    const result = diffSummaryContent(before, after);
    expect(result.rows).toHaveLength(5_000);
    expect(result.stats).toEqual({ added: 0, removed: 0, modified: 5_000 });
  });

  it("returns every contribution between arbitrary version boundaries", () => {
    const version = (sequence: number): SummaryVersionView => ({ id: `v${sequence}`, sequence, kind: "agent-draft", generationMode: "new", operation: sequence ? "regenerate" : "generate", parentVersionId: sequence ? `v${sequence - 1}` : null, baseVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn"], sourceHash: "hash", model: null, content: { ...emptySummaryContent }, createdAt: "now" });
    expect(contributionVersions([version(0), version(1), version(2)], 0, 2).map((item) => item.id)).toEqual(["v1", "v2"]);
  });
});
