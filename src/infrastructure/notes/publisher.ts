import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NotesTargetGateway, PublicationReceipt, PublishSummaryRequest, SummaryPublisher } from "@application/ports";
import type { NotesTargetsView } from "@application/contracts";
import type { Logger } from "@shared/logger";

const execFileAsync = promisify(execFile);

export interface AppleScriptExecutor { execute(scriptPath: string, payload: string): Promise<string>; }

export class OsascriptExecutor implements AppleScriptExecutor {
  async execute(scriptPath: string, payload: string): Promise<string> {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", scriptPath, payload], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  }
}

export class AppleNotesSummaryPublisher implements SummaryPublisher, NotesTargetGateway {
  readonly kind = "apple-notes" as const;
  constructor(
    private readonly scriptPath: string,
    private readonly logger: Logger,
    private readonly executor: AppleScriptExecutor = new OsascriptExecutor(),
  ) {}

  async listTargets(): Promise<NotesTargetsView> {
    const stdout = await this.executor.execute(this.scriptPath, JSON.stringify({ action: "listTargets" }));
    const parsed = JSON.parse(stdout.trim()) as NotesTargetsView;
    if (!Array.isArray(parsed.accounts)) throw new Error("Apple Notes returned an invalid target list.");
    return parsed;
  }

  async publish(request: PublishSummaryRequest): Promise<PublicationReceipt> {
    const payload = JSON.stringify({
      action: "publish",
      account: request.target.account,
      folder: request.target.folder,
      title: request.version.props.content.title,
      html: markdownToNotesHtml(request.version.props.content.bodyMarkdown),
      existingExternalId: request.existingExternalId,
    });
    try {
      const stdout = await this.executor.execute(this.scriptPath, payload);
      const parsed = JSON.parse(stdout.trim()) as PublicationReceipt;
      this.logger.info("[synapse:notes]", "publish-succeeded", { documentId: request.documentId, versionId: request.version.props.id, updated: parsed.updated });
      return parsed;
    } catch (error) {
      this.logger.error("[synapse:notes]", "publish-failed", { documentId: request.documentId, versionId: request.version.props.id, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

function markdownToNotesHtml(markdown: string): string {
  const escaped = markdown
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replaceAll(/`([^`]+)`/g, "<code>$1</code>");
  return escaped.split("\n").map((line) => {
    if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
    if (line.startsWith("- ")) return `<div>• ${line.slice(2)}</div>`;
    return line ? `<div>${line}</div>` : "<br>";
  }).join("");
}
