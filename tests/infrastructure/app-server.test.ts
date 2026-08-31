import { describe, expect, it } from "vitest";
import { CodexAppServerRpcError, CodexAppServerTransportError, JsonRpcRequestRegistry, type CodexAppServerClient, type CodexNotification } from "@infrastructure/app-server/client";
import { AppServerHookTrustGateway, CodexAppServerSummaryAgentGateway } from "@infrastructure/app-server/gateways";
import { CodexAppServerSupervisor } from "@infrastructure/app-server/supervisor";
import { SummaryProfile } from "@domain/summary";
import type { Logger } from "@shared/logger";

const logger: Logger = { info() {}, error() {} };

describe("App Server adapters", () => {
  it("correlates JSON-RPC requests and clears the registry", async () => {
    const registry = new JsonRpcRequestRegistry(); const pending = registry.create(1_000);
    registry.resolve(pending.id, { ok: true });
    await expect(pending.promise).resolves.toEqual({ ok: true });
  });

  it("captures a completion emitted before turn/start returns and uses a fixed output schema", async () => {
    const requests: Array<{ method: string; params: unknown }> = []; const listeners = new Set<(notification: CodexNotification) => void>();
    const client: CodexAppServerClient = {
      async connect() {},
      async request<T>(method: string, params: unknown): Promise<T> {
        requests.push({ method, params });
        if (method === "thread/start") return { thread: { id: "summary-thread" } } as T;
        if (method === "turn/start") {
          for (const listener of listeners) listener({ method: "turn/completed", params: { threadId: "summary-thread", turn: { id: "summary-turn", status: "completed", items: [{ type: "agentMessage", text: JSON.stringify({ title: "Title", abstract: "Abstract", bodyMarkdown: "# Body", tags: ["tag"] }) }] } } });
          return { turn: { id: "summary-turn" } } as T;
        }
        return {} as T;
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, async close() {},
    };
    const gateway = new CodexAppServerSummaryAgentGateway(client, "/tmp/synapse-agent-test");
    const result = await gateway.generate({ jobId: "job", context: { sourceTurnIds: ["turn"], sourceHash: "hash", chunks: [{ turnIds: ["turn"], content: "conversation" }] }, profile: new SummaryProfile("p", "Profile", "systemPrompt", "Summarize facts", true), model: "test-model" });
    expect(result.title).toBe("Title");
    expect(result.stages).toEqual([{ kind: "final", turnIds: ["turn"] }]);
    expect(requests.find((request) => request.method === "thread/start")?.params).toMatchObject({ approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    expect(requests.find((request) => request.method === "turn/start")?.params).toHaveProperty("outputSchema");
  });

  it("resets the supervisor restart budget after a successful request", async () => {
    let attempts = 0; let connects = 0; let closes = 0;
    const client: CodexAppServerClient = {
      async connect() { connects += 1; },
      async request<T>(): Promise<T> { attempts += 1; if (attempts % 2 === 1) throw new CodexAppServerTransportError("process exited"); return { ok: true } as T; },
      subscribe: () => () => undefined,
      async close() { closes += 1; },
    };
    const supervisor = new CodexAppServerSupervisor(client, logger, 1);
    await expect(supervisor.request("model/list", {})).resolves.toEqual({ ok: true });
    await expect(supervisor.request("model/list", {})).resolves.toEqual({ ok: true });
    expect({ attempts, connects, closes }).toEqual({ attempts: 4, connects: 2, closes: 2 });
  });

  it("does not restart the shared App Server for protocol errors", async () => {
    let connects = 0; let closes = 0;
    const client = fakeClient(async () => { throw new CodexAppServerRpcError(-32600, "thread not loaded: missing"); });
    client.connect = async () => { connects += 1; };
    client.close = async () => { closes += 1; };
    const supervisor = new CodexAppServerSupervisor(client, logger);
    await expect(supervisor.request("hooks/list", {})).rejects.toThrow("thread not loaded");
    expect({ connects, closes }).toEqual({ connects: 0, closes: 0 });
  });

  it("coalesces concurrent transport recovery into one restart", async () => {
    let attempts = 0; let connects = 0; let closes = 0;
    const client: CodexAppServerClient = {
      async connect() { connects += 1; },
      async request<T>(): Promise<T> {
        attempts += 1;
        if (attempts <= 2) throw new CodexAppServerTransportError("connection lost");
        return { ok: true } as T;
      },
      subscribe: () => () => undefined,
      async close() { closes += 1; },
    };
    const supervisor = new CodexAppServerSupervisor(client, logger, 1);
    await expect(Promise.all([supervisor.request("hooks/list", {}), supervisor.request("hooks/list", {})])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect({ attempts, connects, closes }).toEqual({ attempts: 4, connects: 1, closes: 1 });
  });

  it("records chunk coverage before the final synthesis", async () => {
    let thread = 0; let turns = 0; const listeners = new Set<(notification: CodexNotification) => void>();
    const client: CodexAppServerClient = {
      async connect() {},
      async request<T>(method: string, params: unknown): Promise<T> {
        if (method === "thread/start") return { thread: { id: `thread-${++thread}` } } as T;
        if (method === "turn/start") {
          turns += 1; const threadId = (params as { threadId: string }).threadId; const turnId = `turn-${turns}`;
          for (const listener of listeners) listener({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [{ type: "agentMessage", text: JSON.stringify({ title: `Title ${turns}`, abstract: "", bodyMarkdown: `Facts ${turns}`, tags: [] }) }] } } });
          return { turn: { id: turnId } } as T;
        }
        return {} as T;
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, async close() {},
    };
    const gateway = new CodexAppServerSummaryAgentGateway(client, "/tmp/synapse-agent-chunks");
    const result = await gateway.generate({ jobId: "job", context: { sourceTurnIds: ["one", "two"], sourceHash: "hash", chunks: [{ turnIds: ["one"], content: "first" }, { turnIds: ["two"], content: "second" }] }, profile: new SummaryProfile("p", "Profile", "systemPrompt", "Summarize", true), model: null });
    expect(result.stages).toEqual([{ kind: "chunk", turnIds: ["one"] }, { kind: "chunk", turnIds: ["two"] }, { kind: "final", turnIds: ["one", "two"] }]);
    expect(turns).toBe(3);
  });

  it("reports the worst trust state for Synapse-owned hooks", async () => {
    const gateway = new AppServerHookTrustGateway(fakeClient(async () => ({ data: [{ cwd: "/repo", hooks: [
      { key: "one", eventName: "sessionStart", command: "'/support/relay'", sourcePath: "/hooks.json", currentHash: `sha256:${"a".repeat(64)}`, trustStatus: "trusted" },
      { key: "two", eventName: "stop", command: "'/support/relay'", sourcePath: "/hooks.json", currentHash: `sha256:${"b".repeat(64)}`, trustStatus: "modified" },
      { key: "other", eventName: "stop", command: "/user/hook", sourcePath: "/hooks.json", currentHash: `sha256:${"c".repeat(64)}`, trustStatus: "untrusted" },
    ] }] })));
    await expect(gateway.inspect(["/repo"], "/support/relay", "/hooks.json")).resolves.toEqual([{
      cwd: "/repo", status: "modified", hooks: [
        { key: "one", eventName: "sessionStart", command: "'/support/relay'", currentHash: `sha256:${"a".repeat(64)}`, status: "trusted" },
        { key: "two", eventName: "stop", command: "'/support/relay'", currentHash: `sha256:${"b".repeat(64)}`, status: "modified" },
      ],
    }]);
  });

  it("persists only exact Synapse hook hashes through the App Server config API", async () => {
    const requests: Array<{ method: string; params: unknown }> = [];
    let trusted = false;
    const gateway = new AppServerHookTrustGateway(fakeClient(async (method, params) => {
      requests.push({ method, params });
      if (method === "config/batchWrite") { trusted = true; return { status: "ok" }; }
      return { data: [{ cwd: "/repo", hooks: [
        { key: "/hooks.json:stop:0:0", eventName: "stop", command: "'/support/relay'", sourcePath: "/hooks.json", currentHash: `sha256:${"d".repeat(64)}`, trustStatus: trusted ? "trusted" : "untrusted" },
        { key: "/hooks.json:stop:1:0", eventName: "stop", command: "'/user/hook'", sourcePath: "/hooks.json", currentHash: `sha256:${"e".repeat(64)}`, trustStatus: "untrusted" },
        { key: "/repo/hooks.json:stop:0:0", eventName: "stop", command: "'/support/relay'", sourcePath: "/repo/hooks.json", currentHash: `sha256:${"f".repeat(64)}`, trustStatus: "untrusted" },
      ] }] };
    }));
    await gateway.trust(["/repo"], "/support/relay", "/hooks.json");
    expect(requests.find((request) => request.method === "config/batchWrite")?.params).toEqual({
      edits: [{ keyPath: "hooks.state.\"/hooks.json:stop:0:0\".trusted_hash", value: `sha256:${"d".repeat(64)}`, mergeStrategy: "upsert" }],
      reloadUserConfig: true,
    });
  });

  it("interrupts the active App Server turn when a summary job is canceled", async () => {
    const listeners = new Set<(notification: CodexNotification) => void>(); const requests: Array<{ method: string; params: unknown }> = [];
    const client: CodexAppServerClient = {
      async connect() {},
      async request<T>(method: string, params: unknown): Promise<T> {
        requests.push({ method, params });
        if (method === "thread/start") return { thread: { id: "thread" } } as T;
        if (method === "turn/start") return { turn: { id: "turn" } } as T;
        return {} as T;
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, async close() {},
    };
    const gateway = new CodexAppServerSummaryAgentGateway(client, "/tmp/synapse-agent-cancel");
    const generation = gateway.generate({ jobId: "job", context: { sourceTurnIds: ["turn"], sourceHash: "hash", chunks: [{ turnIds: ["turn"], content: "content" }] }, profile: new SummaryProfile("p", "Profile", "systemPrompt", "Summarize", true), model: null });
    while (!requests.some((request) => request.method === "turn/start")) await new Promise((resolve) => setTimeout(resolve, 1));
    await Promise.resolve();
    await gateway.cancel("job");
    expect(requests.find((request) => request.method === "turn/interrupt")?.params).toEqual({ threadId: "thread", turnId: "turn" });
    for (const listener of listeners) listener({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "interrupted", items: [] } } });
    await expect(generation).rejects.toThrow(/interrupted/);
  });
});

function fakeClient(handler: (method: string, params: unknown) => Promise<unknown>): CodexAppServerClient {
  return { async connect() {}, request: (method, params) => handler(method, params) as Promise<never>, subscribe: () => () => undefined, async close() {} };
}
