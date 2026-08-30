import type { CodexConversation, ConversationItem, ConversationTurn } from "@domain/conversation";
import type { TurnStatus } from "@domain/session";

type RecordValue = Record<string, unknown>;

export class CodexProtocolMapper {
  toConversation(response: unknown): CodexConversation {
    const root = asRecord(response); const thread = asRecord(root.thread);
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    return { threadId: String(thread.id ?? ""), turns: turns.map((turn, index) => this.toTurn(asRecord(turn), index)) };
  }

  private toTurn(turn: RecordValue, sequence: number): ConversationTurn {
    const rawItems = Array.isArray(turn.items) ? turn.items : [];
    return {
      id: String(turn.id ?? ""), sequence, status: mapTurnStatus(String(turn.status ?? "inProgress")),
      startedAt: epochToIso(turn.startedAt), completedAt: turn.completedAt == null ? null : epochToIso(turn.completedAt),
      items: rawItems.flatMap((item) => this.toItem(asRecord(item))),
    };
  }

  private toItem(item: RecordValue): ConversationItem[] {
    const type = String(item.type ?? "");
    if (type === "reasoning") return [];
    if (type === "userMessage") {
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content.map((part) => asRecord(part)).filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n");
      return text ? [{ type: "user", text }] : [];
    }
    if (type === "agentMessage") return [{ type: "agent", text: String(item.text ?? "") }];
    if (type === "plan") return [{ type: "plan", text: String(item.text ?? "") }];
    if (type === "commandExecution") {
      const command = String(item.command ?? ""); const output = item.aggregatedOutput == null ? "" : String(item.aggregatedOutput);
      return [{ type: "command", status: String(item.status ?? ""), text: output ? `$ ${command}\n${output}` : `$ ${command}` }];
    }
    if (type === "fileChange") return [{ type: "file-change", status: String(item.status ?? ""), text: JSON.stringify(item.changes ?? []) }];
    return [];
  }
}

function asRecord(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }
function mapTurnStatus(status: string): TurnStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return "running";
}
function epochToIso(value: unknown): string { return new Date(Number(value ?? 0) * 1_000).toISOString(); }
