import { describe, expect, it } from "vitest";
import { resolveRendererSurface } from "../../src/renderer/src/lib/renderer-surface";

describe("resolveRendererSurface", () => {
  it("uses an isolated transparent surface for the widget route", () => {
    expect(resolveRendererSurface("#/widget")).toBe("widget");
  });

  it("keeps workspace routes on the regular document surface", () => {
    expect(resolveRendererSurface("#/settings")).toBe("workspace");
    expect(resolveRendererSurface("#/history")).toBe("workspace");
  });
});
