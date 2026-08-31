// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererErrorBoundary } from "../../src/renderer/src/components/RendererErrorBoundary";
import { SettingsPage } from "../../src/renderer/src/features/settings/SettingsPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SettingsPage", () => {
  it("renders first-run Hook setup instead of a blank workspace", async () => {
    installSettingsApi();
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("heading", { name: "连接 Codex，开始感知任务" })).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "安装 Hook" }).length).toBeGreaterThan(0);
  });

  it("shows a recoverable error screen and reports React rendering failures", async () => {
    const reportRendererError = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "synapse", { configurable: true, value: { diagnostics: { reportRendererError } } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<RendererErrorBoundary><Broken /></RendererErrorBoundary>);
    expect(screen.getByRole("heading", { name: "页面加载失败" })).toBeTruthy();
    await waitFor(() => expect(reportRendererError).toHaveBeenCalledWith(expect.objectContaining({ kind: "react-error", message: "render failed" })));
  });
});

function Broken(): never { throw new Error("render failed"); }

function installSettingsApi() {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      settings: {
        read: vi.fn().mockResolvedValue({
          codexBinaryPath: null, summaryModel: null, syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse",
          widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false,
        }),
        runtime: vi.fn().mockResolvedValue({ state: "available", available: true, binaryPath: "/codex", version: "1", authentication: "signed-in", error: null }),
        models: vi.fn().mockResolvedValue([]), notesTargets: vi.fn().mockResolvedValue({ accounts: [] }), update: vi.fn(),
      },
      hooks: {
        inspect: vi.fn().mockResolvedValue({ installed: false, onboardingRequired: true, relayPath: "/relay", configPath: "/hooks.json", trustStates: [], message: null }),
        install: vi.fn(), uninstall: vi.fn(), dismissOnboarding: vi.fn(),
      },
      profiles: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() },
    },
  });
}
