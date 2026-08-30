import type { CodexConversation, SummaryContext } from "./conversation";
import { CodexSessionAggregate, type CodexLifecycleEvent, type CodexTurn } from "./session";
import { DomainError } from "./shared";
import { TurnSelection } from "./summary";

export interface SessionTransition {
  readonly session: CodexSessionAggregate;
  readonly changed: boolean;
}

export interface SessionLifecycleService {
  apply(session: CodexSessionAggregate | null, event: CodexLifecycleEvent): SessionTransition;
}

export class DefaultSessionLifecycleService implements SessionLifecycleService {
  apply(session: CodexSessionAggregate | null, event: CodexLifecycleEvent): SessionTransition {
    const aggregate = session ?? CodexSessionAggregate.create(event.sessionId, event.threadId, event.cwd, event.occurredAt);
    if (event.eventType === "SessionStart") {
      aggregate.observeSession({ cwd: event.cwd, model: event.model, at: event.occurredAt });
    } else if (event.eventType === "UserPromptSubmit") {
      if (!event.turnId) throw new DomainError("MISSING_TURN_ID", "UserPromptSubmit requires a turn id.");
      aggregate.startTurn({ turnId: event.turnId, promptPreview: event.promptPreview, at: event.occurredAt });
    } else {
      if (!event.turnId) throw new DomainError("MISSING_TURN_ID", "Stop requires a turn id.");
      aggregate.completeTurn({ turnId: event.turnId, assistantPreview: event.assistantPreview, at: event.occurredAt });
    }
    return { session: aggregate, changed: true };
  }
}

export interface TurnSelectionService {
  create(availableTurns: readonly CodexTurn[], selectedTurnIds: readonly string[]): TurnSelection;
}

export class ArbitraryTurnSelectionService implements TurnSelectionService {
  create(availableTurns: readonly CodexTurn[], selectedTurnIds: readonly string[]): TurnSelection {
    const selected = new Set(selectedTurnIds);
    if (selected.size !== selectedTurnIds.length) throw new DomainError("DUPLICATE_TURN_SELECTION", "Turn selection contains duplicates.");
    const knownIds = new Set(availableTurns.map((turn) => turn.id));
    const unknown = selectedTurnIds.find((id) => !knownIds.has(id));
    if (unknown) throw new DomainError("UNKNOWN_TURN", `Unknown turn: ${unknown}`);
    const ordered = availableTurns
      .filter((turn) => selected.has(turn.id))
      .sort((left, right) => left.sequence - right.sequence);
    const running = ordered.find((turn) => turn.status === "running");
    if (running) throw new DomainError("RUNNING_TURN_SELECTED", `Running turn cannot be summarized: ${running.id}`);
    return new TurnSelection(ordered.map((turn) => turn.id));
  }
}

export interface SummaryContextService {
  build(conversation: CodexConversation, selection: TurnSelection): Promise<SummaryContext>;
}

export interface ContentHashService {
  sha256(content: string): Promise<string>;
}

export class NormalizedTurnSummaryContextService implements SummaryContextService {
  constructor(
    private readonly hasher: ContentHashService,
    private readonly maxChunkCharacters = 48_000,
    private readonly maxCommandCharacters = 4_000,
  ) {}

  async build(conversation: CodexConversation, selection: TurnSelection): Promise<SummaryContext> {
    const selected = new Set(selection.turnIds);
    const turns = conversation.turns.filter((turn) => selected.has(turn.id)).sort((a, b) => a.sequence - b.sequence);
    if (turns.length !== selection.turnIds.length) throw new DomainError("CONVERSATION_TURN_MISSING", "One or more selected turns are missing from the conversation.");

    const blocks = turns.map((turn) => {
      const items = turn.items.map((item) => {
        const text = item.type === "command" && item.text.length > this.maxCommandCharacters
          ? `${item.text.slice(0, this.maxCommandCharacters)}\n[command output omitted]`
          : item.text;
        return `### ${item.type}${item.status ? ` (${item.status})` : ""}\n${text}`;
      });
      return { turnId: turn.id, content: `## Turn ${turn.sequence + 1} [${turn.status}]\n${items.join("\n\n")}` };
    });

    const chunks: Array<{ turnIds: string[]; content: string }> = [];
    for (const block of blocks) {
      const current = chunks.at(-1);
      if (!current || current.content.length + block.content.length > this.maxChunkCharacters) {
        chunks.push({ turnIds: [block.turnId], content: block.content });
      } else {
        current.turnIds.push(block.turnId);
        current.content += `\n\n${block.content}`;
      }
    }
    const normalized = chunks.map((chunk) => chunk.content).join("\n\n");
    return {
      sourceTurnIds: turns.map((turn) => turn.id),
      sourceHash: await this.hasher.sha256(normalized),
      chunks,
    };
  }
}
