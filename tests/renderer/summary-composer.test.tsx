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
        get: vi.fn().mockResolvedValue({ id: "target", reference: { uri: "synapse://summary/target?v=base", text: "[[Synapse:Existing title|synapse://summary/target?v=base]]" }, publicationStatus: "published", notesLinked: true, currentVersion: { id: "base", kind: "final", generationMode: "new", sourceSessionId: "owner", sourceTurnIds: ["old-turn"], baseVersionId: null, content: { title: "Existing title", abstract: "Existing abstract", bodyMarkdown: "# Existing\n\nKeep", tags: [] }, createdAt: "now" }, versions: [] }),
        generate,
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
});
