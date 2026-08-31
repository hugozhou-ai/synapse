// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetSessionView } from "@application/contracts";
import { Widget } from "../../src/renderer/src/features/widget/Widget";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

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
    const resizeWidget = vi.fn();
    let widgetBlur: () => void = () => undefined;
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { listWidgetQueue: vi.fn(async () => [session]), ignore: vi.fn(), turns: vi.fn() },
      summaries: { generateDefault },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: {
        resizeWidget, openSettings: vi.fn(), openHistory: vi.fn(), openSummaryResult,
        beginWidgetDrag: vi.fn(), moveWidgetDrag: vi.fn(), endWidgetDrag: vi.fn(),
        onWidgetBlur: vi.fn((listener: () => void) => { widgetBlur = listener; return () => undefined; }),
        onSessionsChanged: vi.fn(() => () => undefined), onNavigate: vi.fn(() => () => undefined),
      },
    } });

    render(<Widget />);
    expect(screen.queryByText("Synapse")).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "展开悬浮窗" }));
    await waitFor(() => expect(resizeWidget).toHaveBeenCalledWith({ width: 304, height: 205 }));
    await user.click(await screen.findByRole("button", { name: "总结" }));

    expect(generateDefault).toHaveBeenCalledWith("session");
    expect((screen.getByRole("button", { name: "正在总结" }) as HTMLButtonElement).disabled).toBe(true);
    expect(openSummaryResult).not.toHaveBeenCalled();

    await act(async () => { resolveGeneration(); await generation; });
    const resultLink = await screen.findByRole("button", { name: "打开整理结果" });
    await user.click(resultLink);
    await waitFor(() => expect(openSummaryResult).toHaveBeenCalledWith("document"));

    act(() => widgetBlur());
    expect(screen.queryByText("Task")).toBeNull();
    expect(resizeWidget).toHaveBeenLastCalledWith({ width: 40, height: 40 });
  });

  it("previews the latest status change for three seconds without showing the full queue", async () => {
    vi.useFakeTimers();
    let sessions: readonly WidgetSessionView[] = [{
      id: "session", threadId: "thread", title: "Latest task", cwd: "/repo", status: "running",
      promptPreview: "prompt", elapsedSeconds: 10, lastCompletedTurnId: null, summaryDocumentId: null,
    }];
    let sessionsChanged: () => void = () => undefined;
    const resizeWidget = vi.fn();
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { listWidgetQueue: vi.fn(async () => sessions), ignore: vi.fn(), turns: vi.fn() },
      summaries: { generateDefault: vi.fn() },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: {
        resizeWidget, openSettings: vi.fn(), openHistory: vi.fn(), openSummaryResult: vi.fn(),
        beginWidgetDrag: vi.fn(), moveWidgetDrag: vi.fn(), endWidgetDrag: vi.fn(), onWidgetBlur: vi.fn(() => () => undefined),
        onSessionsChanged: vi.fn((listener: () => void) => { sessionsChanged = listener; return () => undefined; }),
        onNavigate: vi.fn(() => () => undefined),
      },
    } });

    render(<Widget />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Latest task")).toBeNull();

    sessions = [{ ...sessions[0]!, status: "ready" }];
    await act(async () => { sessionsChanged(); await Promise.resolve(); });
    expect(screen.getByText("Latest task")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开历史" })).toBeNull();
    expect(resizeWidget).toHaveBeenCalledWith({ width: 304, height: 131 });

    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByText("Latest task")).toBeNull();
    expect(resizeWidget).toHaveBeenLastCalledWith({ width: 40, height: 40 });
  });

  it("drags the collapsed logo without starting image drag or opening the full widget", () => {
    const beginWidgetDrag = vi.fn();
    const moveWidgetDrag = vi.fn();
    const endWidgetDrag = vi.fn();
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { listWidgetQueue: vi.fn(async () => []), ignore: vi.fn(), turns: vi.fn() },
      summaries: { generateDefault: vi.fn() },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: {
        resizeWidget: vi.fn(), openSettings: vi.fn(), openHistory: vi.fn(), openSummaryResult: vi.fn(),
        beginWidgetDrag, moveWidgetDrag, endWidgetDrag, onWidgetBlur: vi.fn(() => () => undefined),
        onSessionsChanged: vi.fn(() => () => undefined), onNavigate: vi.fn(() => () => undefined),
      },
    } });

    render(<Widget />);
    const logo = screen.getByRole("button", { name: "展开悬浮窗" });
    expect((logo.querySelector("img") as HTMLImageElement).draggable).toBe(false);
    fireEvent.pointerDown(logo, { button: 0, pointerId: 1, screenX: 100, screenY: 100 });
    fireEvent.pointerMove(logo, { pointerId: 1, screenX: 112, screenY: 109 });
    fireEvent.pointerUp(logo, { pointerId: 1, screenX: 112, screenY: 109 });
    fireEvent.click(logo);

    expect(beginWidgetDrag).toHaveBeenCalledWith({ x: 100, y: 100 });
    expect(moveWidgetDrag).toHaveBeenCalledWith({ x: 112, y: 109 });
    expect(endWidgetDrag).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "展开悬浮窗" })).toBeTruthy();
  });
});
