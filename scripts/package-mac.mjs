import { electronBuilder, rebuildForElectron, rebuildForNode, run, runNpm } from "./native-runtime.mjs";

try {
  rebuildForElectron();
  runNpm(["run", "build"]);
  run(electronBuilder, ["--mac"]);
} finally {
  rebuildForNode();
}
