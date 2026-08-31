import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonFileLogger } from "@infrastructure/logging/json-file-logger";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("JsonFileLogger", () => {
  it("persists prefixed JSON lines in a private file", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-logger-")); directories.push(root);
    const path = join(root, "logs", "synapse.log");
    new JsonFileLogger(path).info("[synapse:hook]", "receiver-started", { socketPath: "/socket" });
    const line = (await readFile(path, "utf8")).trim();
    expect(line.startsWith("[synapse:hook] ")).toBe(true);
    expect(JSON.parse(line.slice("[synapse:hook] ".length))).toMatchObject({ level: "info", message: "receiver-started", fields: { socketPath: "/socket" } });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
