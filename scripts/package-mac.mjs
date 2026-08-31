import { electronBuilder, run, runNpm } from "./build-tools.mjs";

runNpm(["run", "build"]);
run(electronBuilder, ["--mac"]);
