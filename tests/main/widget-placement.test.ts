import { describe, expect, it } from "vitest";
import { resolveWidgetPlacement } from "../../src/main/widget-placement";

describe("resolveWidgetPlacement", () => {
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
    { id: 2, workArea: { x: 1440, y: -100, width: 1920, height: 1080 } },
  ];

  it("restores the last external display and clamps stale coordinates", () => {
    expect(resolveWidgetPlacement(displays, 1, "2", { "2": { x: 9_999, y: -9_999 } }, { width: 380, height: 88 }))
      .toEqual({ displayId: "2", x: 2_980, y: -100 });
  });

  it("falls back to the primary display when the saved display is disconnected", () => {
    expect(resolveWidgetPlacement(displays, 1, "9", {}, { width: 380, height: 88 }))
      .toEqual({ displayId: "1", x: 1_044, y: 16 });
  });
});
