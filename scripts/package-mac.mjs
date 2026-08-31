import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronVersion = JSON.parse(readFileSync(join(repositoryRoot, "node_modules", "electron", "package.json"), "utf8")).version;
const electronRebuild = join(repositoryRoot, "node_modules", ".bin", "electron-rebuild");
const electronBuilder = join(repositoryRoot, "node_modules", ".bin", "electron-builder");
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("npm_execpath is unavailable; run this package task through npm.");

function run(command, args) {
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit", env: process.env });
}

function runNpm(args) {
  run(process.execPath, [npmCli, ...args]);
}

try {
  run(electronRebuild, ["-f", "-w", "better-sqlite3", "-v", electronVersion]);
  runNpm(["run", "build"]);
  run(electronBuilder, ["--mac"]);
} finally {
  runNpm(["rebuild", "better-sqlite3"]);
}
