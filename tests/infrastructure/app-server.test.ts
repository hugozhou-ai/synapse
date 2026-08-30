import { describe, expect, it } from "vitest";
import { JsonRpcRequestRegistry, type CodexAppServerClient, type CodexNotification } from "@infrastructure/app-server/client";
import { CodexProtocolMapper } from "@infrastructure/app-server/mapper";
import { AppServerConversationGateway, CodexAppServerSummaryAgentGateway } from "@infrastructure/app-server/gateways";
import { SummaryProfile } from "@domain/summary";

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

  it("starts an ephemeral read-only summary turn with a fixed output schema", async () => {
    const requests: Array<{ method: string; params: unknown }> = []; const listeners = new Set<(notification: CodexNotification) => void>();
    const client: CodexAppServerClient = {
      async connect() {},
      async request<T>(method: string, params: unknown): Promise<T> {
        requests.push({ method, params });
        if (method === "thread/start") return { thread: { id: "summary-thread" } } as T;
        if (method === "turn/start") {
          setTimeout(() => { for (const listener of listeners) listener({ method: "turn/completed", params: { threadId: "summary-thread", turn: { id: "summary-turn", status: "completed", items: [{ type: "agentMessage", text: JSON.stringify({ title: "Title", abstract: "Abstract", bodyMarkdown: "# Body", tags: ["tag"] }) }] } } }); }, 0);
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
});

function fakeClient(handler: (method: string, params: unknown) => Promise<unknown>): CodexAppServerClient {
  return { async connect() {}, request: (method, params) => handler(method, params) as Promise<never>, subscribe: () => () => undefined, async close() {} };
}
