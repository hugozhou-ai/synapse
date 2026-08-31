import { describe, expect, it } from "vitest";
import { RepositorySessionQueryService } from "@application/query-services";
import { CodexSessionAggregate } from "@domain/session";
import { DomainError } from "@domain/shared";

describe("RepositorySessionQueryService", () => {
  it("surfaces App Server unavailability while returning the Hook cache", async () => {
    const session = CodexSessionAggregate.create("session", "thread", "/repo", "a");
    session.startTurn({ turnId: "turn", promptPreview: "prompt", at: "b" }); session.completeTurn({ turnId: "turn", assistantPreview: "done", at: "c" });
    const service = new RepositorySessionQueryService(
      { async findById() { return session; }, async findByThreadId() { return session; }, async save() {}, async listWidgetQueue() { return [session]; }, async search() { return [session]; } },
      { async saveMany() {}, async listBySessionId() { return session.turns; } },
      { now: () => "d" },
      { async readConversation() { throw new DomainError("APP_SERVER_UNAVAILABLE", "App Server unavailable"); }, async waitUntilTurnPersisted() { throw new DomainError("APP_SERVER_UNAVAILABLE", "App Server unavailable"); } },
    );
    const result = await service.getConversationTurns("session");
    expect(result).toMatchObject({ source: "hook-cache", syncStatus: "unavailable", message: "App Server unavailable" });
    expect(result.turns[0]?.promptPreview).toBe("prompt");
  });
});
