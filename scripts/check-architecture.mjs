import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(path);
  }
  return result;
}

const failures = [];
const domainForbidden = ["electron", "node:", "better-sqlite3", "child_process", "osascript", "AppleScript"];
for (const path of await files("src/domain")) {
  const source = await readFile(path, "utf8");
  for (const token of domainForbidden) {
    if (source.includes(`from \"${token}`) || source.includes(`from '${token}`)) failures.push(`${path}: domain imports ${token}`);
  }
}
const rendererForbidden = ["@domain/", "better-sqlite3", "child_process", "node:fs", "node:net", "osascript"];
for (const path of await files("src/renderer")) {
  const source = await readFile(path, "utf8");
  for (const token of rendererForbidden) if (source.includes(token)) failures.push(`${path}: renderer references ${token}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Architecture boundaries verified.");
