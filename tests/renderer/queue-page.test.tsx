// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueuePage } from "../../src/renderer/src/features/queue/QueuePage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("QueuePage summary state", () => {
  it("disables summary and ignore actions while summary generation is running", async () => {
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: {
        listWidgetQueue: vi.fn(async () => [{
          id: "session", threadId: "thread", title: "Task", cwd: "/repo", status: "ready",
          promptPreview: "prompt", elapsedSeconds: 10, lastCompletedTurnId: "turn",
          summaryDocumentId: null, summaryInProgress: true,
        }]),
        ignore: vi.fn(), turns: vi.fn(),
      },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: { onSessionsChanged: vi.fn(() => () => undefined) },
    } });

    render(<QueuePage onSummarize={vi.fn()} onOpenSettings={vi.fn()} />);

    expect((await screen.findByRole("button", { name: "总结中" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "忽略" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
