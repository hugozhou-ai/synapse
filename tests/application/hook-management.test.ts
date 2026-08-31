import { describe, expect, it, vi } from "vitest";
import { CodexHookManagementService } from "@application/hook-management";
import type { ApplicationSettings, CodexHookConfigStore, CodexSessionRepository, HookInstallManifest, HookRelayInstaller, HookTrustGateway, SettingsRepository } from "@application/ports";
import type { Logger } from "@shared/logger";

const manifest: HookInstallManifest = { command: "/support/relay", featureEnabledByInstaller: true, installedAt: "2026-01-01T00:00:00.000Z" };

describe("CodexHookManagementService", () => {
  it("does not report an incomplete installation as healthy", async () => {
    const service = createService({ hooks: {} }, { inspect: vi.fn().mockResolvedValue([]) });
    await expect(service.inspect()).resolves.toMatchObject({ installed: false, onboardingRequired: true, message: "Synapse Hook 安装不完整，请点击“修复安装”。" });
  });

  it("keeps Hook awareness available when App Server trust inspection fails", async () => {
    const logger: Logger = { info: vi.fn(), error: vi.fn() };
    const service = createService(ownedConfiguration(), { inspect: vi.fn().mockRejectedValue(new Error("app server unavailable")) }, logger);
    const status = await service.inspect();
    expect(status.installed).toBe(true);
    expect(status.message).toContain("Hook 已安装，但暂时无法检查信任状态");
    expect(logger.error).toHaveBeenCalledWith("[synapse:hook]", "trust-inspection-failed", expect.objectContaining({ message: "app server unavailable" }));
  });

  it("instructs first-time users to trust an installed Hook when no cwd is known", async () => {
    const service = createService(ownedConfiguration(), { inspect: vi.fn().mockResolvedValue([]) });
    await expect(service.inspect()).resolves.toMatchObject({ installed: true, onboardingRequired: false, message: expect.stringContaining("/hooks") });
  });

  it("does not repeat onboarding after the user explicitly dismisses it", async () => {
    const service = createService({ hooks: {} }, { inspect: vi.fn().mockResolvedValue([]) });
    expect((await service.inspect()).onboardingRequired).toBe(true);
    expect((await service.dismissOnboarding()).onboardingRequired).toBe(false);
  });

  it("does not reopen first-run onboarding after an intentional uninstall", async () => {
    const service = createService(ownedConfiguration(), { inspect: vi.fn().mockResolvedValue([]) });
    expect((await service.inspect()).installed).toBe(true);
    await expect(service.uninstall()).resolves.toMatchObject({ installed: false, onboardingRequired: false });
  });
});

function createService(raw: Record<string, unknown>, trust: HookTrustGateway, logger: Logger = { info() {}, error() {} }) {
  let currentRaw = raw;
  let currentManifest: HookInstallManifest | null = manifest;
  let relayInstalled = true;
  let currentSettings: ApplicationSettings = {
    codexBinaryPath: null, summaryModel: null, syncNotesByDefault: false, notesAccount: null, notesFolder: "Synapse",
    widgetVisible: true, widgetPositions: {}, widgetDisplayId: null, hookSetupAcknowledged: false,
  };
  const config: CodexHookConfigStore = {
    read: vi.fn().mockImplementation(async () => ({ raw: currentRaw, manifest: currentManifest })),
    mergeOwnedHooks: vi.fn().mockImplementation(async () => { currentRaw = ownedConfiguration(); currentManifest = manifest; return manifest; }),
    removeOwnedHooks: vi.fn().mockImplementation(async () => { currentRaw = { hooks: {} }; currentManifest = null; }),
  };
  const relay: HookRelayInstaller = {
    relayPath: manifest.command,
    install: vi.fn().mockImplementation(async () => { relayInstalled = true; }),
    uninstall: vi.fn().mockImplementation(async () => { relayInstalled = false; }),
    exists: vi.fn().mockImplementation(async () => relayInstalled),
  };
  const sessions: CodexSessionRepository = {
    findById: vi.fn().mockResolvedValue(null),
    findByThreadId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    listWidgetQueue: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  };
  const settings: SettingsRepository = {
    read: vi.fn().mockImplementation(async () => currentSettings),
    save: vi.fn().mockImplementation(async (value: ApplicationSettings) => { currentSettings = value; }),
  };
  return new CodexHookManagementService(config, relay, trust, sessions, "/codex/hooks.json", logger, settings);
}

function ownedConfiguration(): Record<string, unknown> {
  const group = { hooks: [{ type: "command", command: "'/support/relay'", statusMessage: "Managed by Synapse" }] };
  return { hooks: { SessionStart: [group], UserPromptSubmit: [group], Stop: [group] } };
}
