import type { WidgetSessionView } from "@application/contracts";

export type SessionStatusSnapshot = ReadonlyMap<string, string>;

export function snapshotSessionStatuses(sessions: readonly WidgetSessionView[]): SessionStatusSnapshot {
  return new Map(sessions.map((session) => [session.id, session.status]));
}

export function findLatestSessionStatusChange(
  previous: SessionStatusSnapshot,
  sessions: readonly WidgetSessionView[],
): WidgetSessionView | null {
  return sessions.find((session) => previous.get(session.id) !== session.status) ?? null;
}
