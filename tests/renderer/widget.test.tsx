// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetSessionView } from "@application/contracts";
import { Widget } from "../../src/renderer/src/features/widget/Widget";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Widget summary actions", () => {
  it("generates in the background, shows loading in place, then exposes a result link", async () => {
    let session: WidgetSessionView = {
      id: "session", threadId: "thread", title: "Task", cwd: "/repo", status: "ready",
      promptPreview: "prompt", elapsedSeconds: 10, lastCompletedTurnId: "turn", summaryDocumentId: null,
    };
    let resolveGeneration!: () => void;
    const generation = new Promise<void>((resolve) => { resolveGeneration = resolve; });
    const generateDefault = vi.fn(async () => {
      await generation;
      session = { ...session, summaryDocumentId: "document" };
      return { documentId: "document", versionId: "version", content: { title: "Summary", abstract: "", bodyMarkdown: "Body", tags: [] } };
    });
    const openSummaryResult = vi.fn();
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { listWidgetQueue: vi.fn(async () => [session]), ignore: vi.fn(), turns: vi.fn() },
      summaries: { generateDefault },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: {
        resizeWidget: vi.fn(), openSettings: vi.fn(), openHistory: vi.fn(), openSummaryResult,
        onSessionsChanged: vi.fn(() => () => undefined), onNavigate: vi.fn(() => () => undefined),
      },
    } });

    render(<Widget />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "展开" }));
    await user.click(await screen.findByRole("button", { name: "总结" }));

    expect(generateDefault).toHaveBeenCalledWith("session");
    expect((screen.getByRole("button", { name: "正在总结" }) as HTMLButtonElement).disabled).toBe(true);
    expect(openSummaryResult).not.toHaveBeenCalled();

    await act(async () => { resolveGeneration(); await generation; });
    const resultLink = await screen.findByRole("button", { name: "打开整理结果" });
    await user.click(resultLink);
    await waitFor(() => expect(openSummaryResult).toHaveBeenCalledWith("document"));
  });
});
