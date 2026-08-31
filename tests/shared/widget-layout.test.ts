import { describe, expect, it } from "vitest";
import { resolveWidgetBounds } from "../../src/shared/widget-layout";

describe("resolveWidgetBounds", () => {
  it("has no overview-only size and fits each reachable mode", () => {
    expect(resolveWidgetBounds("collapsed", 3)).toEqual({ width: 40, height: 40 });
    expect(resolveWidgetBounds("activity", 3)).toEqual({ width: 304, height: 131 });
    expect(resolveWidgetBounds("expanded", 0)).toEqual({ width: 304, height: 223 });
    expect(resolveWidgetBounds("expanded", 3)).toEqual({ width: 304, height: 353 });
    expect(resolveWidgetBounds("expanded", 20)).toEqual({ width: 304, height: 353 });
  });
});
