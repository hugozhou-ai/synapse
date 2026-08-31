// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnSelectionView } from "@application/contracts";
import { TurnSelector } from "../../src/renderer/src/features/summary/TurnSelector";

const turns: readonly TurnSelectionView[] = ["one", "two", "three"].map((id, sequence) => ({
  id, sequence, status: "completed", promptPreview: id, assistantPreview: `${id}-done`,
  startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:01.000Z", selectedByDefault: false,
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TurnSelector", () => {
  it("supports keyboard toggles and Shift range selection", async () => {
    const user = userEvent.setup(); render(<Harness />);
    const rows = screen.getAllByRole("checkbox");
    await user.click(rows[0]!);
    fireEvent.click(rows[2]!, { shiftKey: true });
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    rows[1]!.focus(); await user.keyboard(" ");
    expect(rows[1]?.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps long-press drag as an optional multi-select shortcut", () => {
    vi.useFakeTimers(); Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent }); render(<Harness />);
    const rows = screen.getAllByRole("checkbox");
    fireEvent.pointerDown(rows[0]!, { button: 0 });
    act(() => vi.advanceTimersByTime(350));
    fireEvent.pointerEnter(rows[1]!); fireEvent.pointerEnter(rows[2]!); fireEvent.pointerUp(window);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
  });
});

function Harness() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return <TurnSelector turns={turns} selected={selected} onChange={setSelected} />;
}
