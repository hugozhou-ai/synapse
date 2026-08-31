import { spawn } from "node:child_process";
import { electronVite, rebuildForElectron, rebuildForNode, repositoryRoot } from "./native-runtime.mjs";

let child = null;
const forwardSignal = (signal) => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
};
const onInterrupt = () => forwardSignal("SIGINT");
const onTerminate = () => forwardSignal("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

let exitCode = 0;
try {
  rebuildForElectron();
  child = spawn(electronVite, ["dev"], { cwd: repositoryRoot, stdio: "inherit", env: process.env });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  exitCode = result.code ?? (result.signal === "SIGINT" ? 130 : 1);
} finally {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  rebuildForNode();
}

process.exitCode = exitCode;
