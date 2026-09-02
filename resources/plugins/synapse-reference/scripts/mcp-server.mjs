#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const SERVER_NAME = "synapse-reference";
const SERVER_VERSION = "0.1.0";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME = "resolve_synapse_reference";
const VIEW_VALUES = ["metadata", "abstract", "outline", "section", "full"];
const DEFAULT_LIMIT = 4_000;
const MIN_LIMIT = 200;
const MAX_LIMIT = 20_000;

const tool = {
  name: TOOL_NAME,
  description: "Resolve a user-provided synapse://summary reference. Reads no summary until called. Choose metadata, abstract, outline, one Markdown section, or bounded full content according to the task.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["reference", "view"],
    properties: {
      reference: { type: "string", description: "A synapse://summary URI or copied [[Synapse:...|URI]] reference." },
      view: { type: "string", enum: VIEW_VALUES, description: "Smallest content layer sufficient for the current task." },
      section: { type: "string", description: "Exact Markdown heading to read when view is section." },
      maxChars: { type: "integer", minimum: MIN_LIMIT, maximum: MAX_LIMIT, default: DEFAULT_LIMIT, description: "Maximum returned characters for body content." },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();

export function startServer() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      void handleLine(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
}

async function handleLine(line) {
  let request;
  try { request = JSON.parse(line); }
  catch (error) {
    sendError(null, -32700, "Invalid JSON.");
    log("invalid-json", error);
    return;
  }
  if (!Object.hasOwn(request, "id")) return;
  try {
    const result = dispatch(request.method, request.params ?? {});
    send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    log("request-failed", error, { method: request.method });
    sendError(request.id, error instanceof RequestError ? error.code : -32603, error instanceof Error ? error.message : String(error));
  }
}

function dispatch(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case "ping": return {};
    case "tools/list": return { tools: [tool] };
    case "tools/call": return callTool(params);
    default: throw new RequestError(-32601, `Unsupported method: ${String(method)}`);
  }
}

function callTool(params) {
  if (params.name !== TOOL_NAME) throw new RequestError(-32602, `Unknown tool: ${String(params.name)}`);
  try {
    const result = resolveReference(params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }] };
  }
}

export function resolveReference(input, databasePath = defaultDatabasePath()) {
  const { documentId, versionId, uri } = parseReference(requireString(input.reference, "reference"));
  const view = requireView(input.view);
  const maxChars = input.maxChars === undefined ? DEFAULT_LIMIT : requireLimit(input.maxChars);
  if (view === "section" && !String(input.section ?? "").trim()) throw new Error("section is required when view is section.");
  if (!existsSync(databasePath)) throw new Error("Synapse database was not found. Start Synapse and create a summary first.");

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;");
    const row = database.prepare(`
      SELECT d.id AS document_id, v.id AS version_id, v.sequence, v.kind, v.generation_mode,
             v.title, v.abstract, v.body_markdown, v.tags_json, v.source_session_id,
             v.source_turn_ids_json, v.created_at, s.cwd
      FROM summary_documents d
      JOIN summary_versions v ON v.document_id = d.id
      JOIN codex_sessions s ON s.id = d.session_id
      WHERE d.id = ? AND v.id = ?
      LIMIT 1
    `).get(documentId, versionId);
    if (!row) throw new Error("The referenced Synapse summary version does not exist.");
    return projectResult(row, uri, view, String(input.section ?? ""), maxChars);
  } finally { database.close(); }
}

export function parseReference(value) {
  const match = value.match(/synapse:\/\/summary\/[^\s\]|>]+/);
  if (!match) throw new Error("Reference must contain a synapse://summary URI.");
  let url;
  try { url = new URL(match[0]); }
  catch { throw new Error("Synapse reference URI is invalid."); }
  if (url.protocol !== "synapse:" || url.hostname !== "summary") throw new Error("Only synapse://summary references are supported.");
  const documentId = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const versionId = url.searchParams.get("v") ?? "";
  if (!validIdentifier(documentId) || !validIdentifier(versionId)) throw new Error("Synapse reference must include valid document and version identifiers.");
  return { documentId, versionId, uri: `synapse://summary/${encodeURIComponent(documentId)}?v=${encodeURIComponent(versionId)}` };
}

function projectResult(row, reference, view, requestedSection, maxChars) {
  const metadata = {
    reference,
    documentId: String(row.document_id),
    versionId: String(row.version_id),
    sequence: Number(row.sequence),
    kind: String(row.kind),
    generationMode: String(row.generation_mode),
    title: String(row.title),
    tags: parseArray(row.tags_json),
    cwd: String(row.cwd),
    sourceSessionId: String(row.source_session_id),
    sourceTurnIds: parseArray(row.source_turn_ids_json),
    createdAt: String(row.created_at),
  };
  if (view === "metadata") return { view, ...metadata };
  const abstract = String(row.abstract);
  if (view === "abstract") return { view, ...metadata, abstract };
  const body = String(row.body_markdown);
  const headings = markdownHeadings(body);
  if (view === "outline") return { view, ...metadata, abstract, headings };
  if (view === "section") {
    const selected = markdownSection(body, requestedSection);
    if (!selected) throw new Error(`Markdown section not found: ${requestedSection}`);
    return { view, ...metadata, section: selected.heading, ...boundedContent(selected.content, maxChars) };
  }
  return { view, ...metadata, abstract, ...boundedContent(body, maxChars) };
}

function markdownHeadings(body) {
  return body.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match ? [{ level: match[1].length, heading: match[2] }] : [];
  });
}

function markdownSection(body, requested) {
  const lines = body.split(/\r?\n/);
  const target = requested.trim().replace(/^#{1,6}\s+/, "").toLocaleLowerCase();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match || match[2].trim().toLocaleLowerCase() !== target) continue;
    const level = match[1].length;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor].match(/^(#{1,6})\s+/);
      if (next && next[1].length <= level) { end = cursor; break; }
    }
    return { heading: match[2].trim(), content: lines.slice(index, end).join("\n").trim() };
  }
  return null;
}

function boundedContent(content, maxChars) {
  return { content: content.slice(0, maxChars), totalChars: content.length, returnedChars: Math.min(content.length, maxChars), truncated: content.length > maxChars };
}

function defaultDatabasePath() {
  return process.env.SYNAPSE_DATABASE_PATH || join(homedir(), "Library", "Application Support", "Synapse", "synapse.sqlite3");
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function requireView(value) {
  if (typeof value !== "string" || !VIEW_VALUES.includes(value)) throw new Error(`view must be one of: ${VIEW_VALUES.join(", ")}.`);
  return value;
}

function requireLimit(value) {
  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) throw new Error(`maxChars must be an integer from ${MIN_LIMIT} to ${MAX_LIMIT}.`);
  return value;
}

function validIdentifier(value) { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function parseArray(value) {
  const parsed = JSON.parse(String(value));
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function log(event, error, details = {}) {
  console.error(`[synapse:mcp] ${JSON.stringify({ event, ...details, message: error instanceof Error ? error.message : String(error) })}`);
}

class RequestError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
