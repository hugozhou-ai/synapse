import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { electronExecutable, repositoryRoot } from "./build-tools.mjs";

const vitest = join(repositoryRoot, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(electronExecutable, [vitest, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
