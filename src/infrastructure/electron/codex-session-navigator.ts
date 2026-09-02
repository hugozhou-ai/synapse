import { shell } from "electron";
import type { CodexSessionNavigator } from "@application/ports";

export class ElectronCodexSessionNavigator implements CodexSessionNavigator {
  constructor(private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url)) {}

  async open(threadId: string): Promise<void> {
    await this.openExternal(`codex://threads/${encodeURIComponent(threadId)}`);
  }
}
