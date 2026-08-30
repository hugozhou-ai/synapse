import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { CodexLifecycleEvent } from "@domain/session";
import type { SessionAwarenessService } from "@application/session-services";
import { UnixSocketHookEventReceiver } from "@infrastructure/hooks/receiver";
import { CodexHookProtocolMapper } from "@infrastructure/hooks/mapper";
import { FileSystemHookEventSpool } from "@infrastructure/hooks/spool";
import type { Logger } from "@shared/logger";

const relay = resolve("resources/codex-hook-relay.sh");
const logger: Logger = { info() {}, error() {} };
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("codex-hook-relay", () => {
  it("fails open and spools a 0600 payload while the app is offline", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-offline-")); directories.push(support);
    const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "线程-一", turn_id: "turn-1", cwd: "/tmp/项目", last_assistant_message: "完成" });
    const output = await runRelay(support, payload);
    expect(output.trim()).toBe("{}");
    const files = await readdir(join(support, "spool")); expect(files).toHaveLength(1);
    const path = join(support, "spool", files[0]!);
    expect(await readFile(path, "utf8")).toBe(payload);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("delivers framed Unicode payloads over the Unix socket without creating spool files", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-online-")); directories.push(support);
    const captured: CodexLifecycleEvent[] = [];
    const awareness: SessionAwarenessService = {
      async ingest(event) { captured.push(event); return { sessionId: event.sessionId, status: "ready", duplicate: false }; },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const receiver = new UnixSocketHookEventReceiver(join(support, "run", "hook.sock"), awareness, new CodexHookProtocolMapper(), new FileSystemHookEventSpool(join(support, "spool")), logger, () => undefined);
    await receiver.start();
    try {
      const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "线程-一", turn_id: "turn-1", cwd: "/tmp/项目", last_assistant_message: "完成" });
      expect((await runRelay(support, payload)).trim()).toBe("{}");
      await waitUntil(() => captured.length === 1);
      expect(captured[0]?.sessionId).toBe("线程-一");
      expect(await readdir(join(support, "spool"))).toHaveLength(0);
    } finally { await receiver.stop(); }
  });
});

function runRelay(support: string, payload: string): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("/bin/sh", [relay], { env: { ...process.env, SYNAPSE_SUPPORT_DIR: support } });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveOutput(Buffer.concat(stdout).toString("utf8")) : reject(new Error(Buffer.concat(stderr).toString("utf8"))));
    child.stdin.end(payload);
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for hook event.");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}
