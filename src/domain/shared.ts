export type DomainEventName =
  | "SessionObserved"
  | "TurnStarted"
  | "TurnCompleted"
  | "SummaryDraftGenerated"
  | "SummaryFinalized"
  | "NotesSyncRequested"
  | "NotesSyncCompleted"
  | "NotesSyncFailed";

export interface DomainEvent<T = unknown> {
  readonly name: DomainEventName;
  readonly occurredAt: string;
  readonly payload: T;
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isoNow(): string {
  return new Date().toISOString();
}
