import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = JSON.parse(readFileSync(join(repositoryRoot, "node_modules", "electron", "package.json"), "utf8")).version;
const electronRebuild = join(repositoryRoot, "node_modules", ".bin", "electron-rebuild");
export const electronBuilder = join(repositoryRoot, "node_modules", ".bin", "electron-builder");
export const electronVite = join(repositoryRoot, "node_modules", ".bin", "electron-vite");
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("npm_execpath is unavailable; run this task through npm.");

export function run(command, args) {
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit", env: process.env });
}

export function runNpm(args) {
  run(process.execPath, [npmCli, ...args]);
}

export function rebuildForElectron() {
  run(electronRebuild, ["-f", "-w", "better-sqlite3", "-v", electronVersion]);
}

export function rebuildForNode() {
  runNpm(["rebuild", "better-sqlite3"]);
}
