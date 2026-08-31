import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  private static readonly maxPayloadBytes = 16 * 1024 * 1024;
  constructor(
    private readonly socketPath: string,
    private readonly awareness: SessionAwarenessService,
    private readonly mapper: CodexHookProtocolMapper,
    private readonly spool: HookEventSpool,
    private readonly logger: Logger,
    private readonly onChanged: () => void,
    private readonly internalSessionCwd: string,
  ) {}

  async start(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    await rm(this.socketPath, { force: true });
    this.server = createServer({ allowHalfOpen: true }, (socket) => this.accept(socket));
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
    let buffer = Buffer.alloc(0);
    let expectedLength: number | null = null;
    let payloadOffset = 0;
    let processing = false;
    const finish = (acknowledged: boolean) => socket.end(acknowledged ? "OK\n" : "ERR\n");
    const failFrame = (message: string) => {
      if (processing) return;
      processing = true;
      this.logger.error("[synapse:hook]", "invalid-frame", { message });
      finish(false);
    };
    const processIfComplete = (): void => {
      if (processing) return;
      if (expectedLength === null) {
        const separator = buffer.indexOf(10);
        if (separator < 0) {
          if (buffer.length > 32) failFrame("Hook frame header is too large.");
          return;
        }
        const header = buffer.subarray(0, separator).toString("ascii");
        if (!/^\d+$/.test(header)) { failFrame("Hook frame length is invalid."); return; }
        expectedLength = Number(header);
        if (!Number.isSafeInteger(expectedLength) || expectedLength < 1 || expectedLength > UnixSocketHookEventReceiver.maxPayloadBytes) {
          failFrame("Hook frame length is outside the accepted range."); return;
        }
        payloadOffset = separator + 1;
      }
      const payload = buffer.subarray(payloadOffset);
      if (payload.length < expectedLength) return;
      processing = true;
      void this.ingest(payload.subarray(0, expectedLength).toString("utf8")).then(
        () => finish(true),
        () => finish(false),
      );
    };
    socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, Buffer.from(chunk)]); processIfComplete(); });
    socket.on("end", () => {
      if (!processing) failFrame("Hook connection ended before a complete frame was received.");
    });
    socket.on("error", (error) => this.logger.error("[synapse:hook]", "socket-error", { message: error.message }));
  }

  private async ingest(raw: string): Promise<void> {
    try {
      const event = this.mapper.map(raw.trim());
      if (event.cwd.length > 0 && resolve(event.cwd) === resolve(this.internalSessionCwd)) {
        this.logger.info("[synapse:hook]", "internal-session-filtered", {
          eventType: event.eventType, sessionId: event.sessionId, turnId: event.turnId, cwd: event.cwd,
        });
        return;
      }
      await this.awareness.ingest(event);
      this.onChanged();
      this.logger.info("[synapse:hook]", "event-ingested", { eventType: event.eventType, sessionId: event.sessionId, turnId: event.turnId });
    } catch (error) {
      this.logger.error("[synapse:hook]", "event-ingest-failed", { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
