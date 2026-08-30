import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createServer, type Server, type Socket } from "node:net";
import type { SessionAwarenessService } from "@application/session-services";
import type { Logger } from "@shared/logger";
import { CodexHookProtocolMapper } from "./mapper";
import type { HookEventSpool } from "./spool";

export interface HookEventReceiver {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class UnixSocketHookEventReceiver implements HookEventReceiver {
  private server: Server | null = null;
  constructor(
    private readonly socketPath: string,
    private readonly awareness: SessionAwarenessService,
    private readonly mapper: CodexHookProtocolMapper,
    private readonly spool: HookEventSpool,
    private readonly logger: Logger,
    private readonly onChanged: () => void,
  ) {}

  async start(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await rm(this.socketPath, { force: true });
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
    await chmod(this.socketPath, 0o600);
    const result = await this.spool.replay((raw) => this.ingest(raw));
    this.logger.info("[synapse:hook]", "receiver-started", { socketPath: this.socketPath, ...result });
  }

  async stop(): Promise<void> {
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null; await rm(this.socketPath, { force: true });
  }

  private accept(socket: Socket): void {
    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let processing = false;
    const processIfComplete = () => {
      if (processing) return;
      const data = Buffer.concat(chunks);
      if (expectedLength === null) {
        const separator = data.indexOf(10);
        if (separator < 0) return;
        const header = data.subarray(0, separator).toString("ascii");
        if (!/^\d+$/.test(header)) return;
        expectedLength = Number(header);
        chunks.length = 0; chunks.push(data.subarray(separator + 1));
      }
      const payload = Buffer.concat(chunks);
      if (payload.length < expectedLength) return;
      processing = true;
      void this.ingest(payload.subarray(0, expectedLength).toString("utf8")).finally(() => socket.end());
    };
    socket.on("data", (chunk) => { chunks.push(Buffer.from(chunk)); processIfComplete(); });
    socket.on("end", () => {
      if (!processing) {
        processing = true;
        const raw = Buffer.concat(chunks).toString("utf8");
        void this.ingest(raw).finally(() => socket.end());
      }
    });
    socket.on("error", (error) => this.logger.error("[synapse:hook]", "socket-error", { message: error.message }));
  }

  private async ingest(raw: string): Promise<void> {
    try {
      const event = this.mapper.map(raw.trim());
      await this.awareness.ingest(event);
      this.onChanged();
      this.logger.info("[synapse:hook]", "event-ingested", { eventType: event.eventType, sessionId: event.sessionId, turnId: event.turnId });
    } catch (error) {
      this.logger.error("[synapse:hook]", "event-ingest-failed", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
