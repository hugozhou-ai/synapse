import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemCodexPluginManagement } from "@infrastructure/plugins/codex-plugin-management";
import type { Logger } from "@shared/logger";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("FileSystemCodexPluginManagement", () => {
  it("preserves the personal marketplace, installs a cache-busted bundle, and reports current status", async () => {
    const root = await mkdtemp(join(tmpdir(), "synapse-plugin-management-")); directories.push(root);
    const bundle = join(root, "bundle");
    const home = join(root, "home");
    const marker = join(root, "installed-version");
    const binary = join(root, "codex");
    await mkdir(join(bundle, ".codex-plugin"), { recursive: true });
    await mkdir(join(bundle, "bin"), { recursive: true });
    await writeFile(join(bundle, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "synapse-reference", version: "0.1.0", author: { name: "Synapse Contributors" } }));
    await writeFile(join(bundle, "bin", "synapse-reference-mcp"), "#!/bin/sh\n");
    await mkdir(join(home, ".agents", "plugins"), { recursive: true });
    await writeFile(join(home, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "personal", interface: { displayName: "Mine" }, extra: true, plugins: [{ name: "existing", source: { source: "local", path: "./plugins/existing" } }] }));
    await writeFile(binary, `#!/bin/sh
if [ "$1" = "--version" ]; then echo 'codex-cli 1.0.0'; exit 0; fi
if [ "$1" = "plugin" ] && [ "$2" = "add" ]; then node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.parse(fs.readFileSync(process.argv[2], "utf8")).version)' '${marker}' '${join(home, "plugins", "synapse-reference", ".codex-plugin", "plugin.json")}'; echo '{}'; exit 0; fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then if [ -f '${marker}' ]; then printf '{"installed":[{"pluginId":"synapse-reference@personal","version":"%s","installed":true,"enabled":true}]}' "$(cat '${marker}')"; else echo '{"installed":[]}'; fi; exit 0; fi
exit 1
`);
    await chmod(binary, 0o755);
    const service = new FileSystemCodexPluginManagement(bundle, home, binary, logger);

    const installed = await service.install();
    expect(installed).toMatchObject({ installed: true, current: true, bundledVersion: expect.stringMatching(/^0\.1\.0\+codex\.[a-f0-9]{12}$/) });
    expect((await readFile(join(home, "plugins", "synapse-reference", "bin", "synapse-reference-mcp"))).toString()).toContain("#!/bin/sh");
    const marketplace = JSON.parse(await readFile(join(home, ".agents", "plugins", "marketplace.json"), "utf8")) as { extra: boolean; interface: { displayName: string }; plugins: Array<{ name: string }> };
    expect(marketplace.extra).toBe(true);
    expect(marketplace.interface.displayName).toBe("Mine");
    expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual(["existing", "synapse-reference"]);
    await expect(service.inspect()).resolves.toMatchObject({ installed: true, current: true });
  });
});

const logger: Logger = { info() {}, error() {} };
