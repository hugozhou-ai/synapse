import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockSource = join(repositoryRoot, "build", "icon-master.png");
const statusSource = join(repositoryRoot, "resources", "SynapseStatusTemplate.svg");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "synapse-icons-"));
const iconsetDirectory = join(temporaryDirectory, "Synapse.iconset");

const representations = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];

try {
  mkdirSync(iconsetDirectory);
  for (const [name, size] of representations) {
    execFileSync("sips", ["-z", String(size), String(size), dockSource, "--out", join(iconsetDirectory, name)], { stdio: "ignore" });
  }
  const generatedIcns = join(temporaryDirectory, "icon.icns");
  execFileSync("iconutil", ["-c", "icns", iconsetDirectory, "-o", generatedIcns]);
  atomicCopy(generatedIcns, join(repositoryRoot, "build", "icon.icns"));

  for (const size of [18, 36]) {
    const generatedStatus = join(temporaryDirectory, `status-${size}.png`);
    execFileSync("sips", ["-s", "format", "png", "--resampleHeightWidth", String(size), String(size), statusSource, "--out", generatedStatus], { stdio: "ignore" });
    atomicCopy(generatedStatus, join(repositoryRoot, "resources", size === 18 ? "SynapseStatusTemplate.png" : "SynapseStatusTemplate@2x.png"));
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function atomicCopy(source, destination) {
  const temporaryDestination = `${destination}.tmp-${process.pid}`;
  copyFileSync(source, temporaryDestination);
  renameSync(temporaryDestination, destination);
}
