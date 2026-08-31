import { describe, expect, it } from "vitest";
import { historyWorkspaceDocumentId, parseWorkspaceRoute, summaryWorkspaceRoute } from "../../src/renderer/src/features/workspace/workspace-route";

describe("parseWorkspaceRoute", () => {
  it("honors routes loaded by the main process", () => {
    expect(parseWorkspaceRoute("#/history")).toBe("history");
    expect(parseWorkspaceRoute("#/settings")).toBe("settings");
    expect(parseWorkspaceRoute("summary/session-1")).toBe("summary/session-1");
    expect(parseWorkspaceRoute("history/document-1")).toBe("history/document-1");
    expect(summaryWorkspaceRoute("summary/session-1")).toEqual({ sessionId: "session-1" });
    expect(historyWorkspaceDocumentId("history/document-1")).toBe("document-1");
  });

  it("falls back to the task queue for unsupported routes", () => {
    expect(parseWorkspaceRoute("#/unknown")).toBe("queue");
    expect(parseWorkspaceRoute("summary/nested/session-1")).toBe("queue");
  });
});
