import { contextBridge, ipcRenderer } from "electron";
import type { SynapseApi } from "@shared/synapse-api";

interface IpcSuccess<T> { ok: true; value: T; }
interface IpcFailure { ok: false; error: { code: string; message: string } }

async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const result = await ipcRenderer.invoke(`synapse:${channel}`, input) as IpcSuccess<T> | IpcFailure;
  if (!result.ok) { const error = new Error(result.error.message); error.name = result.error.code; throw error; }
  return result.value;
}

const api: SynapseApi = {
  sessions: {
    listWidgetQueue: () => invoke("sessions:list"), turns: (id) => invoke("sessions:turns", id), ignore: (id) => invoke("sessions:ignore", id),
  },
  summaries: {
    generate: (command) => invoke("summaries:generate", command), regenerate: (command) => invoke("summaries:regenerate", command), updateDraft: (command) => invoke("summaries:update", command),
    finalize: (command) => invoke("summaries:finalize", command), search: (query) => invoke("summaries:search", query),
    get: (id) => invoke("summaries:get", id), retryNotes: (id) => invoke("summaries:retry-notes", id),
  },
  profiles: { list: () => invoke("profiles:list"), save: (command) => invoke("profiles:save", command), delete: (id) => invoke("profiles:delete", id) },
  settings: { read: () => invoke("settings:read"), update: (command) => invoke("settings:update", command), models: () => invoke("settings:models"), runtime: () => invoke("settings:runtime") },
  hooks: { inspect: () => invoke("hooks:inspect"), install: () => invoke("hooks:install"), uninstall: () => invoke("hooks:uninstall") },
  export: { markdown: (id) => invoke("export:markdown", id), json: (id) => invoke("export:json", id), revealDatabase: () => invoke("export:reveal-database") },
  window: {
    openHistory: () => invoke("window:history"), openSummary: (id) => invoke("window:summary", id), resizeWidget: (expanded) => invoke("window:resize-widget", expanded),
    onSessionsChanged: (listener) => { const handler = () => listener(); ipcRenderer.on("synapse:sessions-changed", handler); return () => ipcRenderer.removeListener("synapse:sessions-changed", handler); },
    onNavigate: (listener) => { const handler = (_event: Electron.IpcRendererEvent, path: string) => listener(path); ipcRenderer.on("synapse:navigate", handler); return () => ipcRenderer.removeListener("synapse:navigate", handler); },
  },
};

contextBridge.exposeInMainWorld("synapse", api);
