import type { Logger } from "@shared/logger";
import type { CodexAppServerClient, CodexNotification, Unsubscribe } from "./client";

export class CodexAppServerSupervisor implements CodexAppServerClient {
  private restartCount = 0;
  constructor(private readonly client: CodexAppServerClient, private readonly logger: Logger, private readonly maxRestarts = 2) {}
  connect(): Promise<void> { return this.client.connect(); }
  async request<T>(method: string, params: unknown): Promise<T> {
    try { return await this.client.request<T>(method, params); }
    catch (error) {
      const retryable = method === "thread/read" || method === "model/list" || method === "hooks/list";
      if (!retryable || this.restartCount >= this.maxRestarts) throw error;
      this.restartCount += 1;
      this.logger.error("[synapse:app-server]", "request-retry-after-restart", { method, restartCount: this.restartCount });
      await this.client.close(); await this.client.connect();
      return this.client.request<T>(method, params);
    }
  }
  subscribe(listener: (notification: CodexNotification) => void): Unsubscribe { return this.client.subscribe(listener); }
  close(): Promise<void> { return this.client.close(); }
}
