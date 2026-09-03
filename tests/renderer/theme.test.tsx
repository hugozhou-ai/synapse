// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, readStoredTheme, ThemeProvider, useTheme } from "../../src/renderer/src/theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("visual theme", () => {
  it("uses Native Calm when no valid preference exists", () => {
    expect(readStoredTheme()).toBe("native-calm");
    localStorage.setItem("synapse.visual-theme", "unknown");
    expect(readStoredTheme()).toBe("native-calm");
  });

  it("applies a theme to a supplied document root", () => {
    const root = document.createElement("div");
    applyTheme("editorial", root);
    expect(root.dataset.theme).toBe("editorial");
  });

  it("switches immediately and persists the preference", async () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("native-calm");
    await userEvent.setup().click(screen.getByRole("button", { name: /切换到 Editorial/ }));
    expect(document.documentElement.dataset.theme).toBe("editorial");
    expect(localStorage.getItem("synapse.visual-theme")).toBe("editorial");
  });
});

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return <button onClick={() => setTheme("editorial")}>切换到 Editorial（当前：{theme}）</button>;
}
