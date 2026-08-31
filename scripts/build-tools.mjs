import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const electronBuilder = join(repositoryRoot, "node_modules", ".bin", "electron-builder");
export const electronExecutable = join(repositoryRoot, "node_modules", ".bin", "electron");
export const electronVite = join(repositoryRoot, "node_modules", ".bin", "electron-vite");
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("npm_execpath is unavailable; run this task through npm.");

export function run(command, args) {
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit", env: process.env });
}

export function runNpm(args) {
  run(process.execPath, [npmCli, ...args]);
}
