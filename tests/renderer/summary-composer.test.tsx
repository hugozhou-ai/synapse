// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryComposer } from "../../src/renderer/src/features/summary/SummaryComposer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SummaryComposer", () => {
  it("starts the default full-session summary when opened from the widget", async () => {
    const generateDefault = vi.fn().mockResolvedValue({
      documentId: "document", versionId: "version",
      content: { title: "一键整理结果", abstract: "摘要", bodyMarkdown: "正文", tags: [] },
    });
    const generate = vi.fn();
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { turns: vi.fn().mockResolvedValue({ source: "app-server", syncStatus: "synced", message: null, turns: [] }) },
      profiles: { list: vi.fn().mockResolvedValue([{ id: "default", name: "默认", kind: "systemPrompt", instructions: "rules", isDefault: true }]) },
      settings: { read: vi.fn().mockResolvedValue({ summaryModel: null, syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse" }) },
      summaries: { generateDefault, generate, updateDraft: vi.fn(), finalize: vi.fn() },
    } });

    render(<SummaryComposer sessionId="session" autoGenerate onClose={() => undefined} />);
    expect(screen.getByText("正在生成整理草稿")).toBeTruthy();
    await waitFor(() => expect(generateDefault).toHaveBeenCalledWith("session"));
    expect(await screen.findByRole("heading", { name: "一键整理结果" })).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });
});
