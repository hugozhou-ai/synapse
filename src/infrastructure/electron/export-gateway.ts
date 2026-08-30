import { dialog, shell } from "electron";
import { dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import type { ExportGateway } from "@application/ports";
import type { SummaryDocumentAggregate } from "@domain/summary";

export class ElectronExportGateway implements ExportGateway {
  constructor(private readonly databasePath: string) {}
  async exportMarkdown(document: SummaryDocumentAggregate): Promise<string | null> {
    const current = document.currentVersion; if (!current) return null;
    const path = await choosePath(`${safeName(current.props.content.title)}.md`, [{ name: "Markdown", extensions: ["md"] }]);
    if (path) await writeFile(path, current.props.content.bodyMarkdown, "utf8");
    return path;
  }
  async exportJson(document: SummaryDocumentAggregate): Promise<string | null> {
    const current = document.currentVersion; if (!current) return null;
    const path = await choosePath(`${safeName(current.props.content.title)}.json`, [{ name: "JSON", extensions: ["json"] }]);
    if (path) await writeFile(path, `${JSON.stringify({ document: document.snapshot, currentVersion: current.props }, null, 2)}\n`, "utf8");
    return path;
  }
  async revealDatabaseDirectory(): Promise<void> { await shell.openPath(dirname(this.databasePath)); }
}

async function choosePath(defaultPath: string, filters: Electron.FileFilter[]): Promise<string | null> {
  const result = await dialog.showSaveDialog({ defaultPath, filters, properties: ["createDirectory", "showOverwriteConfirmation"] });
  return result.canceled ? null : result.filePath ?? null;
}
function safeName(value: string): string { return value.replaceAll(/[/:]/g, "-").slice(0, 100) || "synapse-summary"; }
