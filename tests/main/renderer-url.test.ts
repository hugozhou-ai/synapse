import { describe, expect, it } from "vitest";
import { resolveRendererUrl } from "../../src/main/renderer-url";

describe("resolveRendererUrl", () => {
  it("pins localhost development URLs to IPv4 and applies the requested route", () => {
    expect(resolveRendererUrl("http://localhost:43173", "settings")).toBe("http://127.0.0.1:43173/#/settings");
  });

  it("preserves explicit hosts", () => {
    expect(resolveRendererUrl("http://[::1]:43173", "widget")).toBe("http://[::1]:43173/#/widget");
  });
});
