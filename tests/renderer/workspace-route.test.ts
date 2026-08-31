import { describe, expect, it } from "vitest";
import { parseWorkspaceRoute, summaryWorkspaceRoute } from "../../src/renderer/src/features/workspace/workspace-route";

describe("parseWorkspaceRoute", () => {
  it("honors routes loaded by the main process", () => {
    expect(parseWorkspaceRoute("#/history")).toBe("history");
    expect(parseWorkspaceRoute("#/settings")).toBe("settings");
    expect(parseWorkspaceRoute("summary/session-1")).toBe("summary/session-1");
    expect(parseWorkspaceRoute("summary/quick/session-1")).toBe("summary/quick/session-1");
    expect(summaryWorkspaceRoute("summary/quick/session-1")).toEqual({ sessionId: "session-1", autoGenerate: true });
    expect(summaryWorkspaceRoute("summary/session-1")).toEqual({ sessionId: "session-1", autoGenerate: false });
  });

  it("falls back to the task queue for unsupported routes", () => {
    expect(parseWorkspaceRoute("#/unknown")).toBe("queue");
  });
});
