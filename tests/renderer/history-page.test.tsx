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
      id: "doc", reference: { uri: "synapse://summary/doc?v=version", text: "[[Synapse:Summary title|synapse://summary/doc?v=version]]" }, publicationStatus: "not-requested", notesLinked: false, notionLinked: false, publisher: null,
      currentVersion: { id: "version", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn"], sourceHash: "hash", model: "model", baseVersionId: null, content: { title: "Summary title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
      versions: [{ id: "version", sequence: 0, kind: "agent-draft", generationMode: "new", operation: "generate", parentVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn"], sourceHash: "hash", model: "model", baseVersionId: null, content: { title: "Summary title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" }],
    };
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      profiles: { list: vi.fn().mockResolvedValue([]) },
      summaries: {
        search: vi.fn().mockResolvedValue({ total: 0, items: [] }), get: vi.fn().mockResolvedValue(detail), copyReference: vi.fn().mockResolvedValue(detail.reference), delete: remove,
      },
      export: { revealDatabase: vi.fn(), markdown: vi.fn(), json: vi.fn() },
    } });

    render(<HistoryPage documentId="doc" />);
    await screen.findByRole("heading", { name: "Summary title" });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("doc"));
    expect(screen.getByText("选择一条总结查看详情")).toBeTruthy();
  });

  it("copies and exposes the selected immutable summary reference for dragging", async () => {
    const copyReference = vi.fn().mockResolvedValue(undefined);
    const detail: SummaryDetailView = {
      id: "doc", reference: { uri: "synapse://summary/doc?v=version", text: "[[Synapse:Summary title|synapse://summary/doc?v=version]]" }, publicationStatus: "not-requested", notesLinked: false, notionLinked: false, publisher: null,
      currentVersion: { id: "version", sequence: 0, kind: "final", generationMode: "new", operation: "finalize", parentVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn"], sourceHash: "hash", model: null, baseVersionId: null, content: { title: "Summary title", abstract: "Abstract", bodyMarkdown: "Body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" },
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

  it("loads the exact source turns when a version contribution is opened", async () => {
    const version = { id: "version", sequence: 0, kind: "agent-draft", generationMode: "new" as const, operation: "generate" as const, parentVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn", "turn-2"], sourceHash: "source-hash", model: "model", baseVersionId: null, content: { title: "Tracked title", abstract: "", bodyMarkdown: "Tracked body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" };
    const detail: SummaryDetailView = { id: "doc", reference: null, publicationStatus: "not-requested", notesLinked: false, notionLinked: false, publisher: null, currentVersion: version, versions: [version] };
    const source = vi.fn().mockResolvedValue({ available: true, session: { sessionId: "session", threadId: "thread", title: "Source task", cwd: "/repo", model: "model", status: "summarized" }, turns: [{ id: "turn", sequence: 0, status: "completed", promptContent: "完整问题", assistantContent: "完整回答", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" }, { id: "turn-2", sequence: 1, status: "completed", promptContent: "第二个问题", assistantContent: "第二个回答", startedAt: "2026-01-01T00:02:00.000Z", completedAt: "2026-01-01T00:03:00.000Z" }], missingTurnIds: [] });
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      profiles: { list: vi.fn().mockResolvedValue([]) },
      summaries: { search: vi.fn().mockResolvedValue({ total: 0, items: [] }), get: vi.fn().mockResolvedValue(detail), source },
      export: { revealDatabase: vi.fn(), markdown: vi.fn(), json: vi.fn() },
    } });

    render(<HistoryPage documentId="doc" />);
    fireEvent.click(await screen.findByRole("button", { name: /直接来源/ }));
    await waitFor(() => expect(source).toHaveBeenCalledWith("doc", "version"));
    expect(await screen.findByText("完整问题")).toBeTruthy();
    expect(screen.getByText("完整回答")).toBeTruthy();
    expect(screen.getByText("Source task")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /TURN 2/ }));
    expect(screen.getByText("第二个问题")).toBeTruthy();
    expect(screen.queryByText("完整问题")).toBeNull();
  });

  it("opens the source session in Codex Desktop", async () => {
    const version = { id: "version", sequence: 0, kind: "agent-draft", generationMode: "new" as const, operation: "generate" as const, parentVersionId: null, sourceSessionId: "session", sourceTurnIds: ["turn"], sourceHash: "source-hash", model: "model", baseVersionId: null, content: { title: "Tracked title", abstract: "", bodyMarkdown: "Tracked body", tags: [] }, createdAt: "2026-01-01T00:00:00.000Z" };
    const detail: SummaryDetailView = { id: "doc", reference: null, publicationStatus: "not-requested", notesLinked: false, notionLinked: false, publisher: null, currentVersion: version, versions: [version] };
    const openInCodex = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      profiles: { list: vi.fn().mockResolvedValue([]) },
      sessions: { openInCodex },
      summaries: { search: vi.fn().mockResolvedValue({ total: 0, items: [] }), get: vi.fn().mockResolvedValue(detail), source: vi.fn().mockResolvedValue({ available: true, session: { sessionId: "session", threadId: "019c1234-5678-7abc-8def-0123456789ab", title: "Source task", cwd: "/repo", model: "model", status: "summarized" }, turns: [], missingTurnIds: [] }) },
      export: { revealDatabase: vi.fn(), markdown: vi.fn(), json: vi.fn() },
    } });

    render(<HistoryPage documentId="doc" />);
    fireEvent.click(await screen.findByRole("button", { name: /直接来源/ }));
    fireEvent.click(await screen.findByRole("button", { name: "在 Codex 中打开" }));

    await waitFor(() => expect(openInCodex).toHaveBeenCalledWith("019c1234-5678-7abc-8def-0123456789ab"));
  });
});
