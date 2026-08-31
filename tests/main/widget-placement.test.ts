import { describe, expect, it } from "vitest";
import { resolveAnchoredWidgetBounds, resolveWidgetPlacement } from "../../src/main/widget-placement";

describe("resolveWidgetPlacement", () => {
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } },
    { id: 2, workArea: { x: 1440, y: -100, width: 1920, height: 1080 } },
  ];

  it("restores the last external display, aligns right, and clamps stale vertical coordinates", () => {
    expect(resolveWidgetPlacement(displays, 1, "2", { "2": { x: 9_999, y: -9_999 } }, { width: 380, height: 88 }))
      .toEqual({ displayId: "2", x: 2_980, y: -100 });
  });

  it("falls back to the primary display when the saved display is disconnected", () => {
    expect(resolveWidgetPlacement(displays, 1, "9", {}, { width: 380, height: 88 }))
      .toEqual({ displayId: "1", x: 1_060, y: 16 });
  });

  it("keeps every widget mode attached to the right edge", () => {
    expect(resolveAnchoredWidgetBounds(displays[1]!.workArea, { right: 3_360, y: -500 }, { width: 304, height: 353 }))
      .toEqual({ x: 3_056, y: -100, width: 304, height: 353 });
  });

  it("preserves a dragged logo anchor while changing modes", () => {
    expect(resolveAnchoredWidgetBounds(displays[0]!.workArea, { right: 900, y: 120 }, { width: 304, height: 353 }))
      .toEqual({ x: 596, y: 120, width: 304, height: 353 });
    expect(resolveAnchoredWidgetBounds(displays[0]!.workArea, { right: 900, y: 120 }, { width: 40, height: 40 }))
      .toEqual({ x: 860, y: 120, width: 40, height: 40 });
  });
});
