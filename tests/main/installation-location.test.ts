import { describe, expect, it } from "vitest";
import { isInstallerVolumeExecutable } from "../../src/main/installation-location";

describe("isInstallerVolumeExecutable", () => {
  it("detects applications launched from a mounted installer image", () => {
    expect(isInstallerVolumeExecutable("/Volumes/Synapse 0.1.1-arm64/Synapse.app/Contents/MacOS/Synapse")).toBe(true);
  });

  it("allows the installed application", () => {
    expect(isInstallerVolumeExecutable("/Applications/Synapse.app/Contents/MacOS/Synapse")).toBe(false);
  });

  it("does not mistake a similarly named directory for the Volumes root", () => {
    expect(isInstallerVolumeExecutable("/Volumes-backup/Synapse.app/Contents/MacOS/Synapse")).toBe(false);
  });
});
