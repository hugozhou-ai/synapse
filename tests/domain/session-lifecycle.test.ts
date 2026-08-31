import { describe, expect, it } from "vitest";
import { DefaultSessionLifecycleService } from "@domain/services";
import type { CodexLifecycleEvent } from "@domain/session";

const event = (eventType: CodexLifecycleEvent["eventType"], turnId: string | null, at: string): CodexLifecycleEvent => ({
  eventType, sessionId: "session-1", threadId: "session-1", turnId, cwd: "/repo", model: "gpt-test",
  promptContent: eventType === "UserPromptSubmit" ? "Implement feature" : "", assistantContent: eventType === "Stop" ? "Done" : "",
  occurredAt: at, payloadHash: `${eventType}-${at}`,
});

describe("DefaultSessionLifecycleService", () => {
  it("moves a session through observed, running, ready and summarized", () => {
    const service = new DefaultSessionLifecycleService();
    let session = service.apply(null, event("SessionStart", null, "2026-01-01T00:00:00.000Z")).session;
    expect(session.status).toBe("observed");
    session = service.apply(session, event("UserPromptSubmit", "turn-1", "2026-01-01T00:00:01.000Z")).session;
    expect(session.status).toBe("running");
    session = service.apply(session, event("Stop", "turn-1", "2026-01-01T00:00:02.000Z")).session;
    expect(session.status).toBe("ready");
    session.markSummarized("2026-01-01T00:00:03.000Z");
    expect(session.status).toBe("summarized");
  });

  it("does not regress a completed turn when its prompt arrives out of order", () => {
    const service = new DefaultSessionLifecycleService();
    let session = service.apply(null, event("Stop", "turn-1", "2026-01-01T00:00:02.000Z")).session;
    session = service.apply(session, event("UserPromptSubmit", "turn-1", "2026-01-01T00:00:01.000Z")).session;
    expect(session.status).toBe("ready");
    expect(session.turns[0]?.status).toBe("completed");
    expect(session.turns[0]?.props.promptContent).toBe("Implement feature");
  });

  it("keeps the session running when a stale Stop follows a newer prompt", () => {
    const service = new DefaultSessionLifecycleService();
    let session = service.apply(null, event("UserPromptSubmit", "turn-1", "2026-01-01T00:00:01.000Z")).session;
    session = service.apply(session, event("UserPromptSubmit", "turn-2", "2026-01-01T00:00:03.000Z")).session;
    session = service.apply(session, event("Stop", "turn-1", "2026-01-01T00:00:02.000Z")).session;
    expect(session.status).toBe("running");
    expect(session.turns[1]?.status).toBe("running");
  });
});
