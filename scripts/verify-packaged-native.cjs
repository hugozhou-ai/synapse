const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

module.exports = async function verifyPackagedNative(context) {
  if (context.electronPlatformName !== "darwin") return;
  const productName = context.packager.appInfo.productFilename;
  const application = join(context.appOutDir, `${productName}.app`);
  const executable = join(application, "Contents", "MacOS", productName);
  const nativeModule = join(application, "Contents", "Resources", "app.asar.unpacked", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  const probe = spawnSync(executable, ["-e", "require(process.argv[1]); process.stdout.write(JSON.stringify({ modules: process.versions.modules, loaded: true }));", nativeModule], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (probe.status !== 0) {
    throw new Error(`Packaged better-sqlite3 ABI verification failed: ${(probe.stderr || probe.stdout || "unknown error").trim()}`);
  }
  process.stdout.write(`  • packaged native ABI verified  result=${probe.stdout.trim()}\n`);
};
