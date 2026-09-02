// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryDetailView } from "@application/contracts";
import { HistoryPage } from "../../src/renderer/src/features/history/HistoryPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("HistoryPage", () => {
  it("requires an inline confirmation before deleting the selected summary", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const detail: SummaryDetailView = {
      id: "doc", reference: { uri: "synapse://summary/doc?v=version", text: "[[Synapse:Summary title|synapse://summary/doc?v=version]]" }, publicationStatus: "not-requested", notesLinked: false,
      currentVersion: { id: "version", kind: "agent-draft", generationMode: "new", sourceSessionId: "session", sourceTurnIds: ["turn"], baseVersionId: null, content: { title: "Summary title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
      versions: [{ id: "version", kind: "agent-draft", generationMode: "new", sourceSessionId: "session", sourceTurnIds: ["turn"], baseVersionId: null, createdAt: "2026-01-01T00:00:00.000Z" }],
    };
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      profiles: { list: vi.fn().mockResolvedValue([]) },
      summaries: {
        search: vi.fn().mockResolvedValue({ total: 0, items: [] }), get: vi.fn().mockResolvedValue(detail), copyReference: vi.fn().mockResolvedValue(detail.reference), delete: remove,
      },
      export: { revealDatabase: vi.fn(), markdown: vi.fn(), json: vi.fn() },
    } });

    render(<HistoryPage documentId="doc" />);
    await screen.findByText("Summary title");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("doc"));
    expect(screen.getByText("选择一条总结查看详情")).toBeTruthy();
  });

  it("copies and exposes the selected immutable summary reference for dragging", async () => {
    const copyReference = vi.fn().mockResolvedValue(undefined);
    const detail: SummaryDetailView = {
      id: "doc", reference: { uri: "synapse://summary/doc?v=version", text: "[[Synapse:Summary title|synapse://summary/doc?v=version]]" }, publicationStatus: "not-requested", notesLinked: false,
      currentVersion: { id: "version", kind: "final", generationMode: "new", sourceSessionId: "session", sourceTurnIds: ["turn"], baseVersionId: null, content: { title: "Summary title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
      versions: [],
    };
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      profiles: { list: vi.fn().mockResolvedValue([]) },
      summaries: { search: vi.fn().mockResolvedValue({ total: 0, items: [] }), get: vi.fn().mockResolvedValue(detail), copyReference },
      export: { revealDatabase: vi.fn(), markdown: vi.fn(), json: vi.fn() },
    } });
    render(<HistoryPage documentId="doc" />);
    const button = await screen.findByRole("button", { name: "引用" });
    fireEvent.click(button);
    await waitFor(() => expect(copyReference).toHaveBeenCalledWith("doc", "version"));
    expect(screen.getByRole("button", { name: "已复制引用" })).toBeTruthy();
    const setData = vi.fn();
    fireEvent.dragStart(button, { dataTransfer: { effectAllowed: "none", setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", detail.reference?.text);
  });
});
