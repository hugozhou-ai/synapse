import { describe, expect, it } from "vitest";
import { ArbitraryTurnSelectionService } from "@domain/services";
import { CodexTurn } from "@domain/session";

const turn = (id: string, sequence: number, status: "running" | "completed" | "failed" | "interrupted") => new CodexTurn({
  id, sequence, status, promptContent: id, assistantContent: "", startedAt: "2026-01-01T00:00:00.000Z", completedAt: status === "running" ? null : "2026-01-01T00:00:01.000Z",
});

describe("ArbitraryTurnSelectionService", () => {
  const service = new ArbitraryTurnSelectionService();
  const turns = [turn("a", 0, "completed"), turn("b", 1, "failed"), turn("c", 2, "completed")];

  it("supports arbitrary selections and restores conversation order", () => {
    expect(service.create(turns, ["c", "a"]).turnIds).toEqual(["a", "c"]);
  });
  it("allows explicitly selected failed turns", () => { expect(service.create(turns, ["b"]).turnIds).toEqual(["b"]); });
  it("rejects unknown, duplicate and running turns", () => {
    expect(() => service.create(turns, ["missing"])).toThrowError(/Unknown turn/);
    expect(() => service.create(turns, ["a", "a"])).toThrowError(/duplicates/);
    expect(() => service.create([...turns, turn("d", 3, "running")], ["d"])).toThrowError(/Running turn/);
  });
});
