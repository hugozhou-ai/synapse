import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDockController } from "../../src/main/workspace-dock";

describe("WorkspaceDockController", () => {
  afterEach(() => vi.useRealTimers());

  it("hides immediately before any workspace has been shown", () => {
    const dock = { hide: vi.fn(), show: vi.fn().mockResolvedValue(undefined) };
    const controller = new WorkspaceDockController(dock);

    controller.hide();

    expect(dock.hide).toHaveBeenCalledOnce();
  });

  it("delays hiding after showing to respect the macOS Dock transition window", async () => {
    vi.useFakeTimers();
    const dock = { hide: vi.fn(), show: vi.fn().mockResolvedValue(undefined) };
    const controller = new WorkspaceDockController(dock);

    await controller.show();
    controller.hide();

    expect(dock.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_099);
    expect(dock.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(dock.hide).toHaveBeenCalledOnce();
  });

  it("keeps the Dock visible when a workspace reopens before a pending hide", async () => {
    vi.useFakeTimers();
    const dock = { hide: vi.fn(), show: vi.fn().mockResolvedValue(undefined) };
    const controller = new WorkspaceDockController(dock);

    await controller.show();
    controller.hide();
    await vi.advanceTimersByTimeAsync(500);
    await controller.show();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(dock.show).toHaveBeenCalledTimes(2);
    expect(dock.hide).not.toHaveBeenCalled();
  });

  it("does nothing on platforms without a Dock", async () => {
    const controller = new WorkspaceDockController(null);

    await controller.show();
    controller.hide();
  });
});
