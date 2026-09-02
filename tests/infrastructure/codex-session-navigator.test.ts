import { describe, expect, it, vi } from "vitest";
import { ElectronCodexSessionNavigator } from "../../src/infrastructure/electron/codex-session-navigator";

describe("ElectronCodexSessionNavigator", () => {
  it("opens the exact Codex Desktop thread deep link", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const navigator = new ElectronCodexSessionNavigator(openExternal);

    await navigator.open("019c1234-5678-7abc-8def-0123456789ab");

    expect(openExternal).toHaveBeenCalledWith("codex://threads/019c1234-5678-7abc-8def-0123456789ab");
  });
});
