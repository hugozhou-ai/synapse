// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryContentView, SummaryDraft } from "@application/contracts";
import { useSummaryDraft } from "../../src/renderer/src/hooks/use-summary-draft";

const content: SummaryContentView = { title: "Initial", abstract: "", bodyMarkdown: "Body", tags: [] };
const generated: SummaryDraft = { documentId: "doc", versionId: "draft-1", content };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("useSummaryDraft", () => {
  it("autosaves edits after the debounce", async () => {
    vi.useFakeTimers(); const updateDraft = vi.fn().mockResolvedValue({ ...generated, versionId: "draft-2", content: { ...content, title: "Edited" } });
    installApi(updateDraft, vi.fn()); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "生成完成" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Edited" } });
    await act(async () => { vi.advanceTimersByTime(800); await Promise.resolve(); });
    expect(updateDraft).toHaveBeenCalledWith({ documentId: "doc", content: { ...content, title: "Edited" } });
  });

  it("waits for an in-flight autosave before finalizing", async () => {
    vi.useFakeTimers(); let resolveSave!: (value: SummaryDraft) => void;
    const updateDraft = vi.fn().mockImplementation(() => new Promise<SummaryDraft>((resolve) => { resolveSave = resolve; }));
    const finalize = vi.fn().mockResolvedValue({}); installApi(updateDraft, finalize); render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "生成完成" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "Edited" } });
    act(() => vi.advanceTimersByTime(800));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(finalize).not.toHaveBeenCalled();
    await act(async () => { resolveSave({ ...generated, versionId: "draft-2", content: { ...content, title: "Edited" } }); await Promise.resolve(); });
    expect(finalize).toHaveBeenCalledWith({ documentId: "doc", content: { ...content, title: "Edited" }, syncToNotes: false });
  });
});

function Harness() {
  const summary = useSummaryDraft();
  return <div>
    <button onClick={() => summary.acceptGenerated(generated)}>生成完成</button>
    {summary.state.content && <label>标题<input aria-label="标题" value={summary.state.content.title} onChange={(event) => summary.edit({ ...summary.state.content!, title: event.target.value })} /></label>}
    <button onClick={() => void summary.finalize(false)}>完成</button>
  </div>;
}

function installApi(updateDraft: ReturnType<typeof vi.fn>, finalize: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "synapse", { configurable: true, value: { summaries: { updateDraft, finalize } } });
}
