// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/renderer/src/features/workspace/Workspace";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Workspace widget dismissal", () => {
  it("dismisses the widget when pointer input starts on non-interactive text", () => {
    const dismissWidget = vi.fn();
    window.history.replaceState(null, "", "#/queue");
    Object.defineProperty(window, "synapse", { configurable: true, value: {
      sessions: { listWidgetQueue: vi.fn().mockResolvedValue([]) },
      hooks: { inspect: vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks", message: null, trustStates: [] }) },
      window: {
        dismissWidget, onSessionsChanged: vi.fn(() => () => undefined), onNavigate: vi.fn(() => () => undefined),
        openSettings: vi.fn(), resizeWidget: vi.fn(),
      },
    } });

    render(<Workspace />);
    fireEvent.pointerDown(screen.getByText("Local / Codex memory"));
    expect(dismissWidget).toHaveBeenCalledOnce();
  });
});
