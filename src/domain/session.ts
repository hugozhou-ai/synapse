import { DomainError, type DomainEvent } from "./shared";

export type SessionStatus = "observed" | "running" | "ready" | "summarized" | "ignored";
export type TurnStatus = "running" | "completed" | "failed" | "interrupted";
export type LifecycleEventType = "SessionStart" | "UserPromptSubmit" | "Stop";

export interface CodexTurnProps {
  readonly id: string;
  readonly sequence: number;
  readonly status: TurnStatus;
  readonly promptPreview: string;
  readonly assistantPreview: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export class CodexTurn {
  constructor(readonly props: CodexTurnProps) {
    if (!props.id) throw new DomainError("INVALID_TURN_ID", "Turn id cannot be empty.");
  }

  get id(): string { return this.props.id; }
  get sequence(): number { return this.props.sequence; }
  get status(): TurnStatus { return this.props.status; }

  withStatus(status: TurnStatus, completedAt: string | null): CodexTurn {
    return new CodexTurn({ ...this.props, status, completedAt });
  }
}

export interface CodexSessionProps {
  readonly id: string;
  readonly threadId: string;
  readonly cwd: string;
  readonly model: string | null;
  readonly title: string | null;
  readonly status: SessionStatus;
  readonly turns: readonly CodexTurn[];
  readonly lastEventAt: string;
  readonly lastCompletedTurnId: string | null;
  readonly summarizedAt: string | null;
  readonly ignoredAt: string | null;
  readonly sortAt: string;
}

export class CodexSessionAggregate {
  private events: DomainEvent[] = [];

  constructor(private props: CodexSessionProps) {
    if (!props.id || !props.threadId) {
      throw new DomainError("INVALID_SESSION", "Session and thread identifiers are required.");
    }
  }

  static create(id: string, threadId: string, cwd: string, at: string): CodexSessionAggregate {
    return new CodexSessionAggregate({
      id, threadId, cwd, model: null, title: null, status: "observed", turns: [],
      lastEventAt: at, lastCompletedTurnId: null, summarizedAt: null, ignoredAt: null, sortAt: at,
    });
  }

  get id(): string { return this.props.id; }
  get threadId(): string { return this.props.threadId; }
  get status(): SessionStatus { return this.props.status; }
  get turns(): readonly CodexTurn[] { return this.props.turns; }
  get snapshot(): CodexSessionProps { return this.props; }

  observeSession(input: { cwd?: string; model?: string | null; at: string }): void {
    this.props = {
      ...this.props,
      cwd: input.cwd ?? this.props.cwd,
      model: input.model ?? this.props.model,
      status: this.props.status === "observed" || this.props.status === "ignored" ? "observed" : this.props.status,
      lastEventAt: input.at,
    };
    this.events.push({ name: "SessionObserved", occurredAt: input.at, payload: { sessionId: this.id } });
  }

  startTurn(input: { turnId: string; promptPreview: string; at: string }): void {
    const existingIndex = this.props.turns.findIndex((turn) => turn.id === input.turnId);
    const turns = [...this.props.turns];
    const existing = existingIndex >= 0 ? turns[existingIndex]! : null;
    const alreadyFinished = existing !== null && existing.status !== "running";
    const nextTurn = new CodexTurn({
      id: input.turnId,
      sequence: existing?.sequence ?? turns.length,
      status: alreadyFinished ? existing.status : "running",
      promptPreview: input.promptPreview,
      assistantPreview: existing?.props.assistantPreview ?? "",
      startedAt: existing?.props.startedAt ?? input.at,
      completedAt: alreadyFinished ? existing.props.completedAt : null,
    });
    if (existingIndex >= 0) turns[existingIndex] = nextTurn; else turns.push(nextTurn);
    this.props = {
      ...this.props,
      status: alreadyFinished ? this.props.status : "running",
      turns,
      lastEventAt: input.at,
      ignoredAt: null,
      sortAt: input.at,
    };
    if (!alreadyFinished) this.events.push({ name: "TurnStarted", occurredAt: input.at, payload: { sessionId: this.id, turnId: input.turnId } });
  }

  completeTurn(input: { turnId: string; assistantPreview: string; status?: Exclude<TurnStatus, "running">; at: string }): void {
    const turns = [...this.props.turns];
    const index = turns.findIndex((turn) => turn.id === input.turnId);
    const status = input.status ?? "completed";
    if (index < 0) {
      turns.push(new CodexTurn({
        id: input.turnId, sequence: turns.length, status, promptPreview: "",
        assistantPreview: input.assistantPreview, startedAt: input.at, completedAt: input.at,
      }));
    } else {
      const current = turns[index]!;
      turns[index] = new CodexTurn({ ...current.props, status, assistantPreview: input.assistantPreview, completedAt: input.at });
    }
    const hasRunningTurn = turns.some((turn) => turn.status === "running");
    this.props = {
      ...this.props,
      status: hasRunningTurn ? "running" : "ready",
      turns,
      lastEventAt: input.at,
      lastCompletedTurnId: input.turnId,
      sortAt: input.at,
    };
    this.events.push({ name: "TurnCompleted", occurredAt: input.at, payload: { sessionId: this.id, turnId: input.turnId, status } });
  }

  markSummarized(at: string): void {
    if (this.props.status !== "ready" && this.props.status !== "summarized") {
      throw new DomainError("SESSION_NOT_READY", "Only a ready session can be summarized.");
    }
    this.props = { ...this.props, status: "summarized", summarizedAt: at, lastEventAt: at };
  }

  ignore(at: string): void {
    this.props = { ...this.props, status: "ignored", ignoredAt: at, lastEventAt: at };
  }

  pullEvents(): readonly DomainEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }
}

export interface CodexLifecycleEvent {
  readonly eventType: LifecycleEventType;
  readonly sessionId: string;
  readonly threadId: string;
  readonly turnId: string | null;
  readonly cwd: string;
  readonly model: string | null;
  readonly promptPreview: string;
  readonly assistantPreview: string;
  readonly occurredAt: string;
  readonly payloadHash: string;
}
