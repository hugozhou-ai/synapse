import { describe, expect, it } from "vitest";
import { parseWorkspaceRoute } from "../../src/renderer/src/features/workspace/workspace-route";

describe("parseWorkspaceRoute", () => {
  it("honors routes loaded by the main process", () => {
    expect(parseWorkspaceRoute("#/history")).toBe("history");
    expect(parseWorkspaceRoute("#/settings")).toBe("settings");
    expect(parseWorkspaceRoute("summary/session-1")).toBe("summary/session-1");
  });

  it("falls back to the task queue for unsupported routes", () => {
    expect(parseWorkspaceRoute("#/unknown")).toBe("queue");
  });
});
