import { describe, expect, it } from "vitest";
import type { WidgetSessionView } from "../../src/application/contracts";
import { findLatestSessionStatusChange, snapshotSessionStatuses } from "../../src/renderer/src/features/widget/widget-activity";

const session = (id: string, status: string, elapsedSeconds = 1): WidgetSessionView => ({
  id, threadId: id, title: id, cwd: "/repo", status, promptPreview: "", elapsedSeconds,
  lastCompletedTurnId: null, summaryDocumentId: null, summaryInProgress: false,
});

describe("widget activity detection", () => {
  it("detects new and transitioned sessions but ignores elapsed-time refreshes", () => {
    const running = session("running", "running");
    const previous = snapshotSessionStatuses([running]);
    expect(findLatestSessionStatusChange(previous, [{ ...running, elapsedSeconds: 9 }])).toBeNull();
    expect(findLatestSessionStatusChange(previous, [session("running", "ready")])?.status).toBe("ready");
    expect(findLatestSessionStatusChange(previous, [session("new", "running"), running])?.id).toBe("new");
  });
});
