import type { Logger } from "@shared/logger";
import { CodexAppServerTransportError, type CodexAppServerClient, type CodexNotification, type Unsubscribe } from "./client";

export class CodexAppServerSupervisor implements CodexAppServerClient {
  private generation = 0;
  private recovery: Promise<void> | null = null;
  constructor(private readonly client: CodexAppServerClient, private readonly logger: Logger, private readonly maxRestarts = 2) {}
  connect(): Promise<void> { return this.client.connect(); }
  async request<T>(method: string, params: unknown): Promise<T> {
    const retryable = method === "model/list" || method === "hooks/list";
    for (let attempt = 0; ; attempt += 1) {
      const generation = this.generation;
      try { return await this.client.request<T>(method, params); }
      catch (error) {
        if (!retryable || !(error instanceof CodexAppServerTransportError) || attempt >= this.maxRestarts) throw error;
        this.logger.error("[synapse:app-server]", "transport-recovery", {
          method, attempt: attempt + 1, message: error.message,
        });
        await this.recover(generation);
      }
    }
  }
  subscribe(listener: (notification: CodexNotification) => void): Unsubscribe { return this.client.subscribe(listener); }
  close(): Promise<void> { return this.client.close(); }

  private recover(failedGeneration: number): Promise<void> {
    if (failedGeneration !== this.generation) return this.recovery ?? Promise.resolve();
    if (this.recovery) return this.recovery;
    const recovery = (async () => {
      await this.client.close();
      await this.client.connect();
      this.generation += 1;
    })();
    const tracked = recovery.finally(() => {
      if (this.recovery === tracked) this.recovery = null;
    });
    this.recovery = tracked;
    return tracked;
  }
}
