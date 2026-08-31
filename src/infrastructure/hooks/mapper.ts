import { createHash } from "node:crypto";
import { z } from "zod";
import type { CodexLifecycleEvent, LifecycleEventType } from "@domain/session";

const hookPayloadSchema = z.object({
  hook_event_name: z.enum(["SessionStart", "UserPromptSubmit", "Stop"]),
  session_id: z.string().min(1),
  turn_id: z.string().min(1).optional(),
  cwd: z.string().optional().default(""),
  model: z.string().optional(),
  prompt: z.string().optional(),
  last_assistant_message: z.string().optional(),
}).passthrough();

export class CodexHookProtocolMapper {
  map(rawText: string): CodexLifecycleEvent {
    const raw = hookPayloadSchema.parse(JSON.parse(rawText));
    const payloadHash = createHash("sha256").update(rawText).digest("hex");
    return {
      eventType: raw.hook_event_name as LifecycleEventType,
      sessionId: raw.session_id,
      threadId: raw.session_id,
      turnId: raw.turn_id ?? null,
      cwd: raw.cwd,
      model: raw.model ?? null,
      promptContent: normalize(raw.prompt ?? ""),
      assistantContent: normalize(raw.last_assistant_message ?? ""),
      occurredAt: new Date().toISOString(),
      payloadHash,
    };
  }
}

function normalize(value: string): string { return value.replaceAll("\r\n", "\n").trim(); }
