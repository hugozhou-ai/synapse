import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
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
  it("keeps complete prompt and assistant content for local summary generation", () => {
    const prompt = `目标\n${"细节".repeat(400)}`;
    const assistant = `结果\r\n${"证据".repeat(400)}`;
    const event = new CodexHookProtocolMapper().map(JSON.stringify({
      hook_event_name: "Stop", session_id: "session", turn_id: "turn", prompt, last_assistant_message: assistant,
    }));
    expect(event.promptContent).toBe(prompt);
    expect(event.assistantContent).toBe(assistant.replaceAll("\r\n", "\n"));
  });

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
    const receiver = receiverFor(support, awareness);
    await receiver.start();
    try {
      const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "线程-一", turn_id: "turn-1", cwd: "/tmp/项目", last_assistant_message: "完成" });
      expect((await runRelay(support, payload)).trim()).toBe("{}");
      await waitUntil(() => captured.length === 1);
      expect(captured[0]?.sessionId).toBe("线程-一");
      expect(await readdir(join(support, "spool"))).toHaveLength(0);
    } finally { await receiver.stop(); }
  });

  it("filters App Server summary sessions before they reach session awareness", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-internal-")); directories.push(support);
    let ingested = 0; let changed = 0;
    const awareness: SessionAwarenessService = {
      async ingest(event) { ingested += 1; return { sessionId: event.sessionId, status: "ready", duplicate: false }; },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const receiver = receiverFor(support, awareness, () => { changed += 1; });
    await receiver.start();
    try {
      const payload = JSON.stringify({
        hook_event_name: "UserPromptSubmit", session_id: "summary-thread", turn_id: "summary-turn",
        cwd: join(support, "agent-runtime", "."), prompt: "整理以下 Codex 会话内容",
      });
      expect((await runRelay(support, payload)).trim()).toBe("{}");
      expect(ingested).toBe(0);
      expect(changed).toBe(0);
      expect(await readdir(join(support, "spool"))).toHaveLength(0);
    } finally { await receiver.stop(); }
  });

  it("spools the payload when the receiver cannot commit it", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-rejected-")); directories.push(support);
    const awareness: SessionAwarenessService = {
      async ingest() { throw new Error("database unavailable"); },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const receiver = receiverFor(support, awareness);
    await receiver.start();
    try {
      const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "session", turn_id: "turn", cwd: "/tmp/project", last_assistant_message: "done" });
      expect((await runRelay(support, payload)).trim()).toBe("{}");
      const files = await readdir(join(support, "spool"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(support, "spool", files[0]!), "utf8")).toBe(payload);
    } finally { await receiver.stop(); }
  });

  it("acknowledges concurrent large Unicode frames without truncation", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-concurrent-")); directories.push(support);
    const captured = new Set<string>();
    const awareness: SessionAwarenessService = {
      async ingest(event) { captured.add(event.sessionId); return { sessionId: event.sessionId, status: "ready", duplicate: false }; },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const receiver = receiverFor(support, awareness);
    await receiver.start();
    try {
      await Promise.all(Array.from({ length: 6 }, (_, index) => runRelay(support, JSON.stringify({ hook_event_name: "Stop", session_id: `会话-${index}`, turn_id: `turn-${index}`, cwd: "/tmp/项目", last_assistant_message: "完成".repeat(100_000) }))));
      expect(captured.size).toBe(6);
      expect(await readdir(join(support, "spool"))).toHaveLength(0);
    } finally { await receiver.stop(); }
  });

  it("rejects a connection that ends with a partial frame", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-partial-")); directories.push(support);
    let ingested = 0;
    const awareness: SessionAwarenessService = {
      async ingest(event) { ingested += 1; return { sessionId: event.sessionId, status: "ready", duplicate: false }; },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const socketPath = join(support, "run", "hook.sock");
    const receiver = receiverFor(support, awareness);
    await receiver.start();
    try {
      const response = await new Promise<string>((resolveConnection, reject) => {
        const chunks: Buffer[] = [];
        const socket = createConnection(socketPath, () => { socket.end("100\n{\"incomplete\":true}"); });
        socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        socket.on("error", reject); socket.on("close", () => resolveConnection(Buffer.concat(chunks).toString("utf8")));
      });
      expect(response.trim()).toBe("ERR");
      expect(ingested).toBe(0);
    } finally { await receiver.stop(); }
  });

  it("replays an offline spool exactly once when the receiver starts", async () => {
    const support = await mkdtemp(join(tmpdir(), "synapse-relay-replay-")); directories.push(support);
    const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "replayed", turn_id: "turn", cwd: "/tmp/project", last_assistant_message: "done" });
    await runRelay(support, payload);
    const captured: CodexLifecycleEvent[] = [];
    const awareness: SessionAwarenessService = {
      async ingest(event) { captured.push(event); return { sessionId: event.sessionId, status: "ready", duplicate: false }; },
      async replay() { return { accepted: 0, duplicates: 0, failed: 0 }; }, async ignore() {},
    };
    const receiver = receiverFor(support, awareness);
    await receiver.start();
    try {
      expect(captured.map((event) => event.sessionId)).toEqual(["replayed"]);
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

function receiverFor(support: string, awareness: SessionAwarenessService, onChanged: () => void = () => undefined): UnixSocketHookEventReceiver {
  return new UnixSocketHookEventReceiver(
    join(support, "run", "hook.sock"), awareness, new CodexHookProtocolMapper(),
    new FileSystemHookEventSpool(join(support, "spool")), logger, onChanged, join(support, "agent-runtime"),
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for hook event.");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}
