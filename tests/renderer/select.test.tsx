// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "../../src/renderer/src/components/Select";

afterEach(cleanup);

const options = [
  { value: "all", label: "所有项目" },
  { value: "synapse", label: "Synapse" },
  { value: "legacy", label: "旧项目", disabled: true },
  { value: "notes", label: "Notes" },
] as const;

describe("Select", () => {
  it("renders a styled listbox instead of a native select", async () => {
    const onChange = vi.fn();
    const { container } = render(<Select ariaLabel="项目" value="all" options={options} onChange={onChange} />);
    expect(container.querySelector("select")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "项目" }));
    expect(screen.getByRole("listbox", { name: "项目" })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Synapse" }));
    expect(onChange).toHaveBeenCalledWith("synapse");
    expect(screen.queryByRole("listbox", { name: "项目" })).toBeNull();
  });

  it("supports keyboard navigation and skips disabled options", () => {
    const onChange = vi.fn();
    render(<Select ariaLabel="项目" value="synapse" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "项目" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("notes");
  });
});
