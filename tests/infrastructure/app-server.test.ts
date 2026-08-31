import { describe, expect, it } from "vitest";
import { JsonRpcRequestRegistry, type CodexAppServerClient, type CodexNotification } from "@infrastructure/app-server/client";
import { CodexProtocolMapper } from "@infrastructure/app-server/mapper";
import { AppServerConversationGateway, AppServerHookTrustGateway, CodexAppServerSummaryAgentGateway } from "@infrastructure/app-server/gateways";
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

  it("maps protocol DTOs without leaking reasoning and waits through persistence races", async () => {
    let reads = 0;
    const client = fakeClient(async (method) => {
      if (method !== "thread/read") throw new Error("unexpected");
      reads += 1;
      return { thread: { id: "thread", turns: [{ id: "turn", status: reads < 3 ? "inProgress" : "completed", startedAt: 1, completedAt: reads < 3 ? null : 2, items: [
        { type: "userMessage", content: [{ type: "text", text: "prompt" }] }, { type: "reasoning", summary: ["secret"], content: ["secret"] }, { type: "agentMessage", text: "done" },
      ] }] } };
    });
    const conversation = await new AppServerConversationGateway(client, new CodexProtocolMapper()).waitUntilTurnPersisted("thread", "turn");
    expect(reads).toBe(3);
    expect(conversation.turns[0]?.items.map((item) => item.type)).toEqual(["user", "agent"]);
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
      async request<T>(): Promise<T> { attempts += 1; if (attempts % 2 === 1) throw new Error("process exited"); return { ok: true } as T; },
      subscribe: () => () => undefined,
      async close() { closes += 1; },
    };
    const supervisor = new CodexAppServerSupervisor(client, logger, 1);
    await expect(supervisor.request("thread/read", {})).resolves.toEqual({ ok: true });
    await expect(supervisor.request("thread/read", {})).resolves.toEqual({ ok: true });
    expect({ attempts, connects, closes }).toEqual({ attempts: 4, connects: 2, closes: 2 });
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
