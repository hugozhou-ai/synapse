import { createHash, randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "@application/ports";
import type { ContentHashService } from "@domain/services";

export class SystemClock implements Clock { now(): string { return new Date().toISOString(); } }
export class UuidGenerator implements IdGenerator { next(): string { return randomUUID(); } }
export class NodeContentHashService implements ContentHashService {
  async sha256(content: string): Promise<string> { return createHash("sha256").update(content).digest("hex"); }
}
