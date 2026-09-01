// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryComposer } from "../../src/renderer/src/features/summary/SummaryComposer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SummaryComposer destinations", () => {
  it("hides profiles and sends only the existing target when merge mode is selected", async () => {
    const generate = vi.fn().mockResolvedValue({ documentId: "target", versionId: "merge-draft", content: { title: "Existing title", abstract: "", bodyMarkdown: "# Existing\n\nMerged", tags: [] } });
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { turns: vi.fn().mockResolvedValue({ turns: [{ id: "turn", sequence: 0, status: "completed", promptPreview: "prompt", assistantPreview: "result", startedAt: "a", completedAt: "b", selectedByDefault: true }] }) },
      profiles: { list: vi.fn().mockResolvedValue([{ id: "profile", name: "Profile", kind: "template", instructions: "# Template", isDefault: true }]) },
      settings: { read: vi.fn().mockResolvedValue({ codexBinaryPath: null, summaryModel: "model", syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse", widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false }) },
      summaries: {
        search: vi.fn().mockResolvedValue({ total: 1, items: [{ documentId: "target", sessionId: "owner", title: "Existing title", abstract: "Existing abstract", tags: [], cwd: "/repo", profileId: "profile", versionKind: "final", notesLinked: true, updatedAt: "now" }] }),
        get: vi.fn().mockResolvedValue({ id: "target", publicationStatus: "published", notesLinked: true, currentVersion: { id: "base", kind: "final", generationMode: "new", sourceSessionId: "owner", sourceTurnIds: ["old-turn"], baseVersionId: null, content: { title: "Existing title", abstract: "Existing abstract", bodyMarkdown: "# Existing\n\nKeep", tags: [] }, createdAt: "now" }, versions: [] }),
        generate,
        onActivity: vi.fn(() => () => undefined),
      },
    } });

    render(<SummaryComposer sessionId="source" onClose={() => undefined} />);
    await screen.findByLabelText("整理方案");
    fireEvent.click(screen.getByRole("tab", { name: "已有内容" }));
    expect(screen.queryByLabelText("整理方案")).toBeNull();
    expect(screen.queryByText("同步到 Apple Notes")).toBeNull();
    const target = await screen.findByRole("button", { name: /Existing title/ });
    fireEvent.click(target);
    await screen.findByText("final 后自动更新原便签");
    const submit = screen.getByRole("button", { name: "整理到已有内容" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(generate).toHaveBeenCalledWith({
      sessionId: "source", selectedTurnIds: ["turn"], model: "model", destination: { kind: "existing", targetDocumentId: "target" },
    }));
  });

  it("shows only the latest activity for the session being summarized", async () => {
    let activityListener: (activity: { jobId: string; sessionId: string; message: string }) => void = () => undefined;
    let resolveGeneration: (draft: { documentId: string; versionId: string; content: { title: string; abstract: string; bodyMarkdown: string; tags: string[] } }) => void = () => undefined;
    const generate = vi.fn(() => new Promise<Parameters<typeof resolveGeneration>[0]>((resolve) => { resolveGeneration = resolve; }));
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { turns: vi.fn().mockResolvedValue({ turns: [{ id: "turn", sequence: 0, status: "completed", promptPreview: "prompt", assistantPreview: "result", startedAt: "a", completedAt: "b", selectedByDefault: true }] }) },
      profiles: { list: vi.fn().mockResolvedValue([{ id: "profile", name: "Profile", kind: "systemPrompt", instructions: "Summarize", isDefault: true }]) },
      settings: { read: vi.fn().mockResolvedValue({ codexBinaryPath: null, summaryModel: "model", syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse", widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false }) },
      summaries: {
        generate,
        onActivity: vi.fn((listener) => { activityListener = listener; return () => undefined; }),
      },
    } });

    render(<SummaryComposer sessionId="source" onClose={() => undefined} />);
    const submit = await screen.findByRole("button", { name: "总结" });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("正在准备整理任务");

    activityListener({ jobId: "other-job", sessionId: "other", message: "不应展示" });
    expect(status.textContent).not.toContain("不应展示");
    activityListener({ jobId: "job", sessionId: "source", message: "正在保持原文结构并融合新事实…" });
    await waitFor(() => expect(status.textContent).toContain("正在保持原文结构并融合新事实"));

    resolveGeneration({ documentId: "document", versionId: "draft", content: { title: "Title", abstract: "", bodyMarkdown: "Body", tags: [] } });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
