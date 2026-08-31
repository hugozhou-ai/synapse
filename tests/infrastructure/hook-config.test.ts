import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonCodexHookConfigStore } from "@infrastructure/hooks/config-store";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("JsonCodexHookConfigStore", () => {
  it("preserves user hooks, installs idempotently, writes a manifest, and uninstalls only owned handlers", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-hook-config-")); directories.push(root);
    const codex = join(root, "codex"); const support = join(root, "support"); await mkdir(codex);
    await writeFile(join(codex, "hooks.json"), JSON.stringify({ description: "user config", hooks: { Stop: [{ hooks: [{ type: "command", command: "/user/hook", statusMessage: "Managed by Synapse" }] }] } }));
    await writeFile(join(codex, "config.toml"), "model = \"test\"\n");
    const store = new JsonCodexHookConfigStore(codex, support, logger);

    await store.mergeOwnedHooks({ command: "/support/relay", statusMessage: "Managed by Synapse" });
    await store.mergeOwnedHooks({ command: "/support/relay", statusMessage: "Managed by Synapse" });
    const installed = JSON.parse(await readFile(join(codex, "hooks.json"), "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(installed.hooks.Stop?.flatMap((group) => group.hooks).filter((hook) => hook.command.includes("/support/relay"))).toHaveLength(1);
    expect(installed.hooks.Stop?.flatMap((group) => group.hooks).some((hook) => hook.command === "/user/hook")).toBe(true);
    expect(await readFile(join(codex, "config.toml"), "utf8")).toContain("hooks = true");
    expect((await store.read()).manifest?.command).toBe("/support/relay");

    await store.removeOwnedHooks((await store.read()).manifest!);
    const uninstalled = JSON.parse(await readFile(join(codex, "hooks.json"), "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    expect(uninstalled.hooks.Stop?.flatMap((group) => group.hooks).map((hook) => hook.command)).toEqual(["/user/hook"]);
    expect(await readFile(join(codex, "config.toml"), "utf8")).not.toContain("hooks = true");
  });

  it("rejects invalid existing JSON instead of overwriting it", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-hook-invalid-")); directories.push(root);
    const codex = join(root, "codex"); await mkdir(codex); await writeFile(join(codex, "hooks.json"), "not-json");
    const store = new JsonCodexHookConfigStore(codex, join(root, "support"), logger);
    await expect(store.mergeOwnedHooks({ command: "/relay", statusMessage: "Managed by Synapse" })).rejects.toThrow();
    expect(await readFile(join(codex, "hooks.json"), "utf8")).toBe("not-json");
  });

  it("repairs a hooks feature flag that was disabled after installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-hook-repair-")); directories.push(root);
    const codex = join(root, "codex"); await mkdir(codex); await writeFile(join(codex, "config.toml"), "[features]\nhooks = false\n");
    const store = new JsonCodexHookConfigStore(codex, join(root, "support"), logger);
    await store.mergeOwnedHooks({ command: "/relay", statusMessage: "Managed by Synapse" });
    await writeFile(join(codex, "config.toml"), "[features]\nhooks = false\n");
    await store.mergeOwnedHooks({ command: "/relay", statusMessage: "Managed by Synapse" });
    expect(await readFile(join(codex, "config.toml"), "utf8")).toContain("hooks = true");
    await writeFile(join(codex, "config.toml"), "[features]\nhooks = false\n");
    await store.removeOwnedHooks((await store.read()).manifest!);
    expect(await readFile(join(codex, "config.toml"), "utf8")).toContain("hooks = false");
  });
});
