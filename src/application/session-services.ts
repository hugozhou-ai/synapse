import type { CodexLifecycleEvent } from "@domain/session";
import type { SessionLifecycleService } from "@domain/services";
import type { Clock, CodexSessionRepository, CodexTurnRepository, HookEventRepository, IdGenerator, OutboxRepository, UnitOfWork } from "./ports";
import type { ReplayResult, SessionTransitionResult } from "./contracts";

export interface SessionAwarenessService {
  ingest(event: CodexLifecycleEvent): Promise<SessionTransitionResult>;
  replay(events: readonly CodexLifecycleEvent[]): Promise<ReplayResult>;
  ignore(sessionId: string): Promise<void>;
}

export class HookBasedSessionAwarenessService implements SessionAwarenessService {
  constructor(
    private readonly lifecycle: SessionLifecycleService,
    private readonly sessions: CodexSessionRepository,
    private readonly turns: CodexTurnRepository,
    private readonly hookEvents: HookEventRepository,
    private readonly outbox: OutboxRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async ingest(event: CodexLifecycleEvent): Promise<SessionTransitionResult> {
    const key = [event.sessionId, event.turnId ?? "", event.eventType, event.payloadHash].join(":");
    return this.unitOfWork.execute(async () => {
      if (await this.hookEvents.exists(key)) return { sessionId: event.sessionId, status: "duplicate", duplicate: true };
      const existing = await this.sessions.findById(event.sessionId);
      const transition = this.lifecycle.apply(existing, event);
      await this.hookEvents.add({ deduplicationKey: key, event, receivedAt: this.clock.now() });
      await this.sessions.save(transition.session);
      await this.turns.saveMany(transition.session.id, transition.session.turns);
      for (const domainEvent of transition.session.pullEvents()) {
        await this.outbox.add({
          id: this.ids.next(), kind: "domain-event", aggregateId: transition.session.id,
          payload: domainEvent, createdAt: this.clock.now(), processedAt: null, attempts: 0, lastError: null,
        });
      }
      return { sessionId: event.sessionId, status: transition.session.status, duplicate: false };
    });
  }

  async replay(events: readonly CodexLifecycleEvent[]): Promise<ReplayResult> {
    let accepted = 0; let duplicates = 0; let failed = 0;
    for (const event of events) {
      try {
        const result = await this.ingest(event);
        if (result.duplicate) duplicates += 1; else accepted += 1;
      } catch { failed += 1; }
    }
    return { accepted, duplicates, failed };
  }

  async ignore(sessionId: string): Promise<void> {
    await this.unitOfWork.execute(async () => {
      const session = await this.sessions.findById(sessionId);
      if (!session) return;
      session.ignore(this.clock.now());
      await this.sessions.save(session);
    });
  }
}
