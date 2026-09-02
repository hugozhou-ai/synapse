import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseReference, resolveReference } from "../../resources/plugins/synapse-reference/scripts/mcp-server.mjs";

const directories = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("Synapse reference MCP", () => {
  it("parses both raw and copied immutable references", () => {
    expect(parseReference("synapse://summary/doc?v=version")).toEqual({ documentId: "doc", versionId: "version", uri: "synapse://summary/doc?v=version" });
    expect(parseReference("[[Synapse:Title|synapse://summary/doc?v=version]]")).toEqual({ documentId: "doc", versionId: "version", uri: "synapse://summary/doc?v=version" });
    expect(() => parseReference("synapse://summary/doc")).toThrow(/version identifiers/);
  });

  it("returns only the requested content layer and enforces bounds", async () => {
    const databasePath = await fixtureDatabase();
    const reference = "synapse://summary/doc?v=version";

    const metadata = resolveReference({ reference, view: "metadata" }, databasePath);
    expect(metadata).toMatchObject({ view: "metadata", title: "Architecture", versionId: "version", sourceSessionId: "session" });
    expect(metadata).not.toHaveProperty("abstract");
    expect(metadata).not.toHaveProperty("content");

    const outline = resolveReference({ reference, view: "outline" }, databasePath);
    expect(outline.headings).toEqual([{ level: 1, heading: "Architecture" }, { level: 2, heading: "Decision" }, { level: 2, heading: "Other" }]);
    expect(outline).not.toHaveProperty("content");

    const section = resolveReference({ reference, view: "section", section: "Decision", maxChars: 200 }, databasePath);
    expect(section).toMatchObject({ section: "Decision", content: "## Decision\n\nUse explicit references.", truncated: false });

    const full = resolveReference({ reference, view: "full", maxChars: 200 }, databasePath);
    expect(full.content).toContain("Use explicit references");
    expect(full.returnedChars).toBeLessThanOrEqual(200);
  });

  it("rejects a version that does not belong to the referenced document", async () => {
    const databasePath = await fixtureDatabase();
    expect(() => resolveReference({ reference: "synapse://summary/doc?v=other", view: "metadata" }, databasePath)).toThrow(/does not exist/);
  });
});

async function fixtureDatabase() {
  const root = await mkdtemp(join(tmpdir(), "synapse-reference-mcp-"));
  directories.push(root);
  const databasePath = join(root, "synapse.sqlite3");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE codex_sessions(id TEXT PRIMARY KEY, cwd TEXT NOT NULL);
    CREATE TABLE summary_documents(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, current_version_id TEXT);
    CREATE TABLE summary_versions(
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
      generation_mode TEXT NOT NULL, title TEXT NOT NULL, abstract TEXT NOT NULL, body_markdown TEXT NOT NULL,
      tags_json TEXT NOT NULL, source_session_id TEXT NOT NULL, source_turn_ids_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO codex_sessions VALUES ('session', '/repo');
    INSERT INTO summary_documents VALUES ('doc', 'session', 'version');
    INSERT INTO summary_versions VALUES (
      'version', 'doc', 2, 'final', 'new', 'Architecture', 'A compact abstract.',
      '# Architecture\n\n## Decision\n\nUse explicit references.\n\n## Other\n\nKeep private.',
      '["architecture"]', 'session', '["turn"]', '2026-01-01T00:00:00.000Z'
    );
  `);
  database.close();
  return databasePath;
}
