// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HookInstallationStatus } from "@application/ports";
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

  it("requires an explicit command review before trusting installed hooks", async () => {
    const trust = vi.fn().mockResolvedValue({ installed: true, trusted: true, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks.json", trustStates: [], message: null });
    installSettingsApi({
      installed: true, trusted: false, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks.json", message: "待信任",
      trustStates: [{ cwd: "/repo", status: "untrusted", hooks: [{ key: "key", eventName: "stop", command: "'/relay'", currentHash: `sha256:${"a".repeat(64)}`, status: "untrusted" }] }],
    }, trust);
    render(<SettingsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "检查并信任" }));
    expect(screen.getByRole("heading", { name: "信任 Synapse Hook" })).toBeTruthy();
    expect(screen.getByText("'/relay'")).toBeTruthy();
    expect(trust).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "信任并启用（1）" }));
    await waitFor(() => expect(trust).toHaveBeenCalledOnce());
  });

  it("does not show an untrusted state before Hook inspection completes", async () => {
    const untrusted: HookInstallationStatus = {
      installed: true, trusted: false, onboardingRequired: false, relayPath: "/relay", configPath: "/hooks.json", message: "待信任", trustStates: [],
    };
    let resolveInspection!: (status: HookInstallationStatus) => void;
    const inspection = new Promise<HookInstallationStatus>((resolve) => { resolveInspection = resolve; });
    installSettingsApi(untrusted, vi.fn(), vi.fn().mockReturnValue(inspection));
    render(<SettingsPage />);

    expect(screen.getByRole("status").textContent).toContain("正在检测 Hook 状态");
    expect(screen.queryByText("待信任")).toBeNull();
    expect(screen.queryByText("未安装")).toBeNull();

    await act(async () => { resolveInspection(untrusted); await inspection; });
    await waitFor(() => expect(screen.getAllByText("待信任").length).toBeGreaterThan(0));
  });
});

function Broken(): never { throw new Error("render failed"); }

function installSettingsApi(hookStatus: HookInstallationStatus = { installed: false, trusted: false, onboardingRequired: true, relayPath: "/relay", configPath: "/hooks.json", trustStates: [], message: null }, trust = vi.fn(), inspect = vi.fn().mockResolvedValue(hookStatus)) {
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
        inspect,
        install: vi.fn(), trust, uninstall: vi.fn(), dismissOnboarding: vi.fn(),
      },
      profiles: { list: vi.fn().mockResolvedValue([]), save: vi.fn(), delete: vi.fn() },
    },
  });
}
