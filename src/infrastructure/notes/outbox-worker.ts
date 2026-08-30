import type { Clock, OutboxRepository } from "@application/ports";
import type { SummaryPublicationService } from "@application/summary-services";
import type { Logger } from "@shared/logger";

export class NotesOutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly publication: SummaryPublicationService,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  start(intervalMs = 5_000): void { this.timer = setInterval(() => void this.runOnce(), intervalMs); void this.runOnce(); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      for (const message of await this.outbox.listPending("notes-sync", 20)) {
        try { await this.publication.publishCurrent(message.aggregateId); await this.outbox.markProcessed(message.id, this.clock.now()); }
        catch (error) {
          await this.outbox.markFailed(message.id, error instanceof Error ? error.message : String(error));
          this.logger.error("[synapse:notes]", "outbox-delivery-failed", { messageId: message.id, documentId: message.aggregateId, message: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally { this.running = false; }
  }
}
