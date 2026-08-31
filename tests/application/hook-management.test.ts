import { describe, expect, it, vi } from "vitest";
import { CodexHookManagementService } from "@application/hook-management";
import type { CodexHookConfigStore, CodexSessionRepository, HookInstallManifest, HookRelayInstaller, HookTrustGateway } from "@application/ports";
import type { Logger } from "@shared/logger";

const manifest: HookInstallManifest = { command: "/support/relay", featureEnabledByInstaller: true, installedAt: "2026-01-01T00:00:00.000Z" };

describe("CodexHookManagementService", () => {
  it("does not report an incomplete installation as healthy", async () => {
    const service = createService({ hooks: {} }, { inspect: vi.fn().mockResolvedValue([]) });
    await expect(service.inspect()).resolves.toMatchObject({ installed: false, message: "Synapse Hook 安装不完整，请点击“修复安装”。" });
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
    await expect(service.inspect()).resolves.toMatchObject({ installed: true, message: expect.stringContaining("/hooks") });
  });
});

function createService(raw: Record<string, unknown>, trust: HookTrustGateway, logger: Logger = { info() {}, error() {} }) {
  const config: CodexHookConfigStore = {
    read: vi.fn().mockResolvedValue({ raw, manifest }),
    mergeOwnedHooks: vi.fn().mockResolvedValue(manifest),
    removeOwnedHooks: vi.fn().mockResolvedValue(undefined),
  };
  const relay: HookRelayInstaller = {
    relayPath: manifest.command,
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  };
  const sessions: CodexSessionRepository = {
    findById: vi.fn().mockResolvedValue(null),
    findByThreadId: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    listWidgetQueue: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  };
  return new CodexHookManagementService(config, relay, trust, sessions, "/codex/hooks.json", logger);
}

function ownedConfiguration(): Record<string, unknown> {
  const group = { hooks: [{ type: "command", command: "'/support/relay'", statusMessage: "Managed by Synapse" }] };
  return { hooks: { SessionStart: [group], UserPromptSubmit: [group], Stop: [group] } };
}
