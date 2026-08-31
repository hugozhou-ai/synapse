import { mkdir } from "node:fs/promises";
import type { AgentModel, ConversationGateway, HookTrustGateway, HookTrustState, SummaryAgentGateway, SummaryAgentRequest } from "@application/ports";
import type { CodexConversation, GeneratedSummary } from "@domain/conversation";
import { DomainError } from "@domain/shared";
import { z } from "zod";
import type { CodexAppServerClient, CodexNotification } from "./client";
import { CodexProtocolMapper } from "./mapper";

const generatedSummarySchema = z.object({
  title: z.string().min(1), abstract: z.string(), bodyMarkdown: z.string(), tags: z.array(z.string()),
});

const outputSchema = {
  type: "object", additionalProperties: false, required: ["title", "abstract", "bodyMarkdown", "tags"],
  properties: {
    title: { type: "string" }, abstract: { type: "string" }, bodyMarkdown: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

export class AppServerConversationGateway implements ConversationGateway {
  constructor(private readonly client: CodexAppServerClient, private readonly mapper: CodexProtocolMapper) {}
  async readConversation(threadId: string): Promise<CodexConversation> {
    return this.mapper.toConversation(await this.client.request("thread/read", { threadId, includeTurns: true }));
  }
  async waitUntilTurnPersisted(threadId: string, turnId: string): Promise<CodexConversation> {
    for (const delay of [0, 250, 500, 1_000, 2_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const conversation = await this.readConversation(threadId);
      const turn = conversation.turns.find((item) => item.id === turnId);
      if (turn && turn.status !== "running") return conversation;
    }
    throw new DomainError("CONVERSATION_SYNC_PENDING", "会话仍在同步，请稍后重试。");
  }
}

interface ActiveTurn { readonly threadId: string; readonly turnId: string; }

export class CodexAppServerSummaryAgentGateway implements SummaryAgentGateway {
  private readonly jobs = new Map<string, ActiveTurn>();
  constructor(private readonly client: CodexAppServerClient, private readonly runtimeDirectory: string) {}

  async generate(request: SummaryAgentRequest): Promise<GeneratedSummary> {
    await mkdir(this.runtimeDirectory, { recursive: true, mode: 0o700 });
    const stages: Array<{ kind: "chunk" | "final"; turnIds: readonly string[] }> = [];
    let source: string;
    if (request.context.chunks.length === 1) source = request.context.chunks[0]!.content;
    else {
      const facts: string[] = [];
      for (const chunk of request.context.chunks) {
        const result = await this.runOne(request.jobId, chunk.content, "提取这部分会话中可验证的目标、行动、文件变化、命令结果、决策、问题和后续事项。保持简洁，不臆测。", request.model);
        facts.push(`覆盖 turns: ${chunk.turnIds.join(", ")}\n${result.bodyMarkdown}`);
        stages.push({ kind: "chunk", turnIds: chunk.turnIds });
      }
      source = `以下是按 turn 边界生成的中间事实摘要：\n\n${facts.join("\n\n---\n\n")}`;
    }
    const profileInstruction = request.profile.kind === "template"
      ? `严格保持以下 Markdown 骨架和标题结构并填充内容：\n\n${request.profile.instructions}`
      : request.profile.instructions;
    const result = await this.runOne(request.jobId, source, profileInstruction, request.model);
    return { ...result, stages: [...stages, { kind: "final", turnIds: request.context.sourceTurnIds }] };
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.jobs.get(jobId); if (!active) return;
    await this.client.request("turn/interrupt", active);
  }

  async listModels(): Promise<readonly AgentModel[]> {
    const response = await this.client.request<{ data?: Array<{ id?: string; model?: string; displayName?: string; isDefault?: boolean; hidden?: boolean }> }>("model/list", {});
    return (response.data ?? []).filter((model) => !model.hidden).map((model) => ({
      id: String(model.model ?? model.id ?? ""), displayName: String(model.displayName ?? model.model ?? model.id ?? ""), isDefault: Boolean(model.isDefault),
    }));
  }

  private async runOne(jobId: string, source: string, instructions: string, model: string | null): Promise<Omit<GeneratedSummary, "stages">> {
    const started = await this.client.request<{ thread: { id: string } }>("thread/start", {
      model, cwd: this.runtimeDirectory, approvalPolicy: "never", sandbox: "read-only", ephemeral: true,
      baseInstructions: "你是只读的会话整理 agent。只能依据输入整理总结，不得调用工具、不得读取或修改文件、不得访问网络、不得虚构事实。只输出符合给定 JSON Schema 的对象。",
      developerInstructions: instructions,
    });
    const threadId = started.thread.id;
    const completion = createTurnCompletionWaiter(this.client, threadId);
    let turnStarted: { turn: { id: string } };
    try {
      turnStarted = await this.client.request<{ turn: { id: string } }>("turn/start", {
        threadId, input: [{ type: "text", text: `整理以下 Codex 会话内容：\n\n${source}`, text_elements: [] }], outputSchema,
      });
    } catch (error) {
      completion.cancel();
      await completion.promise.catch(() => undefined);
      throw error;
    }
    const turnId = turnStarted.turn.id;
    this.jobs.set(jobId, { threadId, turnId });
    try {
      const turn = await completion.promise;
      if (turn.id !== turnId) throw new Error(`Summary completion belonged to unexpected turn ${String(turn.id)}.`);
      if (String(turn.status) !== "completed") throw new Error(`Summary turn ended with status ${String(turn.status)}.`);
      const items = Array.isArray(turn.items) ? turn.items as Array<Record<string, unknown>> : [];
      const message = [...items].reverse().find((item) => item.type === "agentMessage");
      if (!message) throw new Error("Summary agent returned no final message.");
      const parsed = generatedSummarySchema.parse(JSON.parse(String(message.text ?? "")));
      return { ...parsed, model };
    } finally {
      this.jobs.delete(jobId);
      await this.client.request("thread/unsubscribe", { threadId }).catch(() => undefined);
    }
  }
}

function createTurnCompletionWaiter(client: CodexAppServerClient, threadId: string): { promise: Promise<Record<string, unknown>>; cancel(): void } {
  let cancel: () => void = () => undefined;
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true; clearTimeout(timer); unsubscribe(); action();
    };
    const unsubscribe = client.subscribe((notification: CodexNotification) => {
      if (notification.method !== "turn/completed") return;
      const params = notification.params as { threadId?: unknown; turn?: Record<string, unknown> };
      if (params.threadId !== threadId || !params.turn) return;
      settle(() => resolve(params.turn!));
    });
    const timer = setTimeout(() => settle(() => reject(new Error("Summary agent timed out."))), 20 * 60 * 1_000);
    cancel = () => settle(() => reject(new Error("Summary turn wait canceled.")));
  });
  return { promise, cancel };
}

export class AppServerHookTrustGateway implements HookTrustGateway {
  constructor(private readonly client: CodexAppServerClient) {}
  async inspect(cwds: readonly string[]): Promise<readonly HookTrustState[]> {
    const response = await this.client.request<{ data?: Array<{ cwd?: string; hooks?: Array<{ statusMessage?: string | null; trustStatus?: HookTrustState["status"] }> }> }>("hooks/list", { cwds });
    return (response.data ?? []).map((entry) => {
      const owned = (entry.hooks ?? []).filter((hook) => hook.statusMessage === "Managed by Synapse");
      return { cwd: String(entry.cwd ?? ""), status: worstTrust(owned.map((hook) => hook.trustStatus ?? "unknown")) };
    });
  }
}

function worstTrust(values: readonly HookTrustState["status"][]): HookTrustState["status"] {
  for (const value of ["modified", "untrusted", "unknown", "trusted", "managed"] as const) if (values.includes(value)) return value;
  return "unknown";
}
