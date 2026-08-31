// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "../../src/renderer/src/components/DatePicker";

afterEach(cleanup);

describe("DatePicker", () => {
  it("renders a themed calendar instead of a native date input", async () => {
    const onChange = vi.fn();
    const { container } = render(<DatePicker ariaLabel="开始日期" value="2026-08-31" onChange={onChange} />);
    expect(container.querySelector('input[type="date"]')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "开始日期" }));
    expect(screen.getByRole("dialog", { name: "开始日期日历" })).toBeTruthy();
    expect(screen.getByText("2026年8月")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "2026年9月1日" }));
    expect(onChange).toHaveBeenCalledWith("2026-09-01");
    expect(screen.queryByRole("dialog", { name: "开始日期日历" })).toBeNull();
  });
});
