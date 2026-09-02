import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import type { Logger } from "@shared/logger";

export interface CodexNotification { readonly method: string; readonly params: unknown; }
export type Unsubscribe = () => void;

export class CodexAppServerRpcError extends Error {
  override readonly name = "CodexAppServerRpcError";
  constructor(readonly code: unknown, message: string) {
    super(`App Server ${String(code)}: ${message}`);
  }
}

export class CodexAppServerTransportError extends Error {
  override readonly name = "CodexAppServerTransportError";
}

export interface CodexAppServerClient {
  connect(): Promise<void>;
  request<T>(method: string, params: unknown): Promise<T>;
  subscribe(listener: (notification: CodexNotification) => void): Unsubscribe;
  authorizeMcp?(threadId: string, serverName: string): Unsubscribe;
  close(): Promise<void>;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class JsonRpcRequestRegistry {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  create(timeoutMs: number): { id: number; promise: Promise<unknown> } {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodexAppServerTransportError(`App Server request ${id} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return { id, promise };
  }

  resolve(id: number, value: unknown): void { const item = this.take(id); item?.resolve(value); }
  reject(id: number, error: Error): void { const item = this.take(id); item?.reject(error); }
  rejectAll(error: Error): void { for (const id of this.pending.keys()) this.reject(id, error); }
  private take(id: number): PendingRequest | undefined {
    const item = this.pending.get(id); if (!item) return undefined;
    clearTimeout(item.timer); this.pending.delete(id); return item;
  }
}

export class StdioCodexAppServerClient implements CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lines: ReadLineInterface | null = null;
  private readonly requests = new JsonRpcRequestRegistry();
  private readonly listeners = new Set<(notification: CodexNotification) => void>();
  private readonly authorizedMcpThreads = new Map<string, string>();
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly binaryPath: string,
    private readonly logger: Logger,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  connect(): Promise<void> {
    if (this.process) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.start().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.connect();
    const pending = this.requests.create(this.requestTimeoutMs);
    try { this.send({ method, id: pending.id, params }); }
    catch (error) { this.requests.reject(pending.id, toTransportError(error)); }
    return pending.promise as Promise<T>;
  }

  subscribe(listener: (notification: CodexNotification) => void): Unsubscribe {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }

  authorizeMcp(threadId: string, serverName: string): Unsubscribe {
    this.authorizedMcpThreads.set(threadId, serverName);
    return () => this.authorizedMcpThreads.delete(threadId);
  }

  async close(): Promise<void> {
    const child = this.process;
    this.process = null; this.lines?.close(); this.lines = null;
    if (!child) return;
    this.requests.rejectAll(new CodexAppServerTransportError("Codex App Server connection closed."));
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(); }, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }

  private async start(): Promise<void> {
    const child = spawn(this.binaryPath, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.logger.info("[synapse:app-server]", "stderr", { message });
    });
    child.once("error", (error) => this.handleExit(child, error));
    child.once("exit", (code, signal) => this.handleExit(child, new Error(`App Server exited (${String(code)}/${String(signal)}).`)));
    const initialized = this.requests.create(this.requestTimeoutMs);
    try {
      try {
        this.send({
          method: "initialize", id: initialized.id,
          params: { clientInfo: { name: "synapse", title: "Synapse", version: "0.1.0" }, capabilities: { optOutNotificationMethods: ["item/reasoning/textDelta", "item/reasoning/summaryTextDelta"] } },
        });
      } catch (error) { this.requests.reject(initialized.id, toTransportError(error)); }
      await initialized.promise;
      this.send({ method: "initialized", params: {} });
    } catch (error) {
      const connectionError = error instanceof Error ? error : new Error(String(error));
      this.requests.reject(initialized.id, connectionError);
      if (this.process === child) {
        this.process = null;
        this.lines?.close();
        this.lines = null;
        this.requests.rejectAll(toTransportError(error));
        child.kill("SIGTERM");
      }
      throw connectionError;
    }
    this.logger.info("[synapse:app-server]", "connected", { binaryPath: this.binaryPath });
  }

  private send(message: unknown): void {
    if (!this.process?.stdin.writable) throw new CodexAppServerTransportError("Codex App Server is not connected.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try { message = JSON.parse(line) as typeof message; }
    catch (error) { this.logger.error("[synapse:app-server]", "invalid-json", { message: error instanceof Error ? error.message : String(error) }); return; }
    if (typeof message.id === "number" && typeof message.method === "string") { this.respondToServerRequest(message); return; }
    if (typeof message.id === "number") {
      if (message.error) this.requests.reject(message.id, new CodexAppServerRpcError(message.error.code, String(message.error.message)));
      else this.requests.resolve(message.id, message.result);
      return;
    }
    if (typeof message.method === "string") {
      const notification = { method: message.method, params: message.params };
      for (const listener of this.listeners) listener(notification);
    }
  }

  private respondToServerRequest(message: { id?: unknown; method?: unknown; params?: unknown }): void {
    const method = String(message.method);
    let result: unknown = { decision: "decline" };
    if (method === "item/permissions/requestApproval") result = { permissions: {}, scope: "turn", strictAutoReview: true };
    if (method === "item/tool/requestUserInput") result = this.mcpApprovalResponse(message.params);
    if (method === "mcpServer/elicitation/request") result = { action: "decline", content: null, _meta: null };
    this.send({ id: message.id, result });
    const details = { details: JSON.stringify({ method, accepted: hasAnswers(result) }) };
    if (hasAnswers(result)) this.logger.info("[synapse:app-server]", "server-request-resolved", details);
    else this.logger.error("[synapse:app-server]", "server-request-resolved", details);
  }

  private mcpApprovalResponse(params: unknown): { answers: Record<string, { answers: string[] }> } {
    return createMcpApprovalResponse(params, (threadId) => this.authorizedMcpThreads.has(threadId));
  }

  private handleExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.process !== child) return;
    this.process = null; this.requests.rejectAll(toTransportError(error));
    this.logger.error("[synapse:app-server]", "process-exited", { message: error.message });
  }
}

export function createMcpApprovalResponse(params: unknown, isAuthorized: (threadId: string) => boolean): { answers: Record<string, { answers: string[] }> } {
  if (!params || typeof params !== "object") return { answers: {} };
  const input = params as { threadId?: unknown; questions?: unknown };
  const threadId = String(input.threadId ?? "");
  if (!isAuthorized(threadId) || !Array.isArray(input.questions)) return { answers: {} };
  const answers: Record<string, { answers: string[] }> = {};
  for (const raw of input.questions) {
    if (!raw || typeof raw !== "object") return { answers: {} };
    const question = raw as { id?: unknown; options?: unknown };
    if (typeof question.id !== "string" || !Array.isArray(question.options)) return { answers: {} };
    const accept = question.options.find((option) => option && typeof option === "object" && /^(accept|allow)$/i.test(String((option as { label?: unknown }).label ?? ""))) as { label?: unknown } | undefined;
    if (!accept || typeof accept.label !== "string") return { answers: {} };
    answers[question.id] = { answers: [accept.label] };
  }
  return { answers };
}

function hasAnswers(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("answers" in value)) return false;
  return Object.keys((value as { answers: Record<string, unknown> }).answers).length > 0;
}

function toTransportError(error: unknown): CodexAppServerTransportError {
  if (error instanceof CodexAppServerTransportError) return error;
  return new CodexAppServerTransportError(error instanceof Error ? error.message : String(error));
}
