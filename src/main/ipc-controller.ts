import { ipcMain } from "electron";
import { z } from "zod";
import type { ElectronApplicationContainer } from "./container";
import type { ElectronWindowManager } from "./window-manager";
import { DomainError } from "@domain/shared";
import { PublicationTarget } from "@domain/summary";
import type { ApplicationSettingsUpdate, SummarySearchCriteria } from "@application/ports";
import type { SaveProfileCommand } from "@application/contracts";
import { WIDGET_COLLAPSED_SIZE, WIDGET_EXPANDED_WIDTH, WIDGET_MAX_HEIGHT } from "@shared/widget-layout";

const idSchema = z.string().min(1);
const summaryContentSchema = z.object({ title: z.string().min(1), abstract: z.string(), bodyMarkdown: z.string(), tags: z.array(z.string()) });
const searchSchema = z.object({ text: z.string().optional(), cwd: z.string().optional(), profileId: z.string().optional(), status: z.string().optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(200), offset: z.number().int().min(0) });
const publicationTargetSchema = z.object({ account: z.string().nullable(), folder: z.string().min(1) }).nullable();
const generateSchema = z.object({ sessionId: idSchema, selectedTurnIds: z.array(idSchema).min(1), profileId: idSchema, model: z.string().nullable(), syncToNotes: z.boolean(), publicationTarget: publicationTargetSchema });
const regenerateSchema = z.object({ documentId: idSchema, selectedTurnIds: z.array(idSchema).min(1), profileId: idSchema, model: z.string().nullable() });
const settingsSchema = z.object({
  codexBinaryPath: z.string().nullable(), summaryModel: z.string().nullable(), syncNotesByDefault: z.boolean(),
  notesAccount: z.string().nullable(), notesFolder: z.string().min(1), widgetVisible: z.boolean(),
  widgetPositions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })), widgetDisplayId: z.string().nullable(),
}).partial();
const rendererErrorSchema = z.object({
  kind: z.enum(["window-error", "unhandled-rejection", "react-error"]),
  message: z.string().max(4_000), stack: z.string().max(20_000).nullable(), componentStack: z.string().max(20_000).nullable(),
});
const pointerPositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export class ElectronIpcController {
  constructor(private readonly container: ElectronApplicationContainer, private readonly windows: ElectronWindowManager) {}

  register(): void {
    this.handle("sessions:list", z.unknown(), () => this.container.sessionQueries.listWidgetQueue());
    this.handle("sessions:turns", idSchema, (id) => this.container.sessionQueries.getConversationTurns(id));
    this.handle("sessions:ignore", idSchema, async (id) => { await this.container.sessionAwareness.ignore(id); this.windows.broadcastSessionsChanged(); });
    this.handle("summaries:generate", generateSchema, async (value) => {
      const result = await this.container.summaryGeneration.generateDraft({ ...value, publicationTarget: value.publicationTarget ? new PublicationTarget(value.publicationTarget.account, value.publicationTarget.folder) : null });
      this.windows.broadcastSessionsChanged(); return result;
    });
    this.handle("summaries:generate-default", idSchema, async (id) => {
      const result = await this.container.defaultSessionSummary.generate(id);
      this.windows.broadcastSessionsChanged(); return result;
    });
    this.handle("summaries:regenerate", regenerateSchema, (value) => this.container.summaryGeneration.regenerate(value));
    this.handle("summaries:update", z.object({ documentId: idSchema, content: summaryContentSchema }), (value) => this.container.summaryFinalization.updateDraft(value));
    this.handle("summaries:finalize", z.object({ documentId: idSchema, content: summaryContentSchema, syncToNotes: z.boolean() }), async (value) => {
      const version = await this.container.summaryFinalization.finalize(value); this.windows.broadcastSessionsChanged(); return version.props;
    });
    this.handle("summaries:search", searchSchema, (value) => this.container.summaryQueries.search(compactObject<SummarySearchCriteria>(value)));
    this.handle("summaries:get", idSchema, (id) => this.container.summaryQueries.getDocument(id));
    this.handle("summaries:delete", idSchema, async (id) => { await this.container.summaryDeletion.delete(id); this.windows.broadcastSessionsChanged(); });
    this.handle("summaries:retry-notes", idSchema, (id) => this.container.summaryPublication.retry(id));
    this.handle("profiles:list", z.unknown(), () => this.container.profiles.list());
    this.handle("profiles:save", z.object({ id: idSchema.optional(), name: z.string().min(1), kind: z.enum(["template", "systemPrompt"]), instructions: z.string().min(1), isDefault: z.boolean() }), (value) => this.container.profiles.save(compactObject<SaveProfileCommand>(value)));
    this.handle("profiles:delete", idSchema, (id) => this.container.profiles.delete(id));
    this.handle("settings:read", z.unknown(), () => this.container.settings.read());
    this.handle("settings:update", settingsSchema, (value) => this.container.settings.update(compactObject<ApplicationSettingsUpdate>(value)));
    this.handle("settings:models", z.unknown(), () => this.container.settings.listModels());
    this.handle("settings:notes-targets", z.unknown(), () => this.container.settings.listNotesTargets());
    this.handle("settings:runtime", z.unknown(), () => this.container.settings.runtime());
    this.handle("hooks:inspect", z.unknown(), () => this.container.hookManagement.inspect());
    this.handle("hooks:install", z.unknown(), () => this.container.hookManagement.install());
    this.handle("hooks:trust", z.unknown(), () => this.container.hookManagement.trust());
    this.handle("hooks:uninstall", z.unknown(), () => this.container.hookManagement.uninstall());
    this.handle("hooks:dismiss-onboarding", z.unknown(), () => this.container.hookManagement.dismissOnboarding());
    this.handle("export:markdown", idSchema, (id) => this.container.exports.markdown(id));
    this.handle("export:json", idSchema, (id) => this.container.exports.json(id));
    this.handle("export:reveal-database", z.unknown(), () => this.container.exports.revealDatabaseDirectory());
    this.handle("diagnostics:renderer-error", rendererErrorSchema, (report) => {
      this.container.logger.error("[synapse:renderer]", "uncaught-error", report);
    });
    this.handle("window:history", z.unknown(), () => this.windows.openHistory());
    this.handle("window:queue", z.unknown(), () => this.windows.openQueue());
    this.handle("window:settings", z.unknown(), () => this.windows.openSettings());
    this.handle("window:summary-result", idSchema, (id) => this.windows.openSummaryResult(id));
    this.handle("window:resize-widget", z.object({
      width: z.union([z.literal(WIDGET_COLLAPSED_SIZE), z.literal(WIDGET_EXPANDED_WIDTH)]),
      height: z.number().int().min(WIDGET_COLLAPSED_SIZE).max(WIDGET_MAX_HEIGHT),
    }), (bounds) => { this.windows.resizeWidget(bounds); });
    this.handle("window:widget-drag-start", pointerPositionSchema, (pointer) => { this.windows.beginWidgetDrag(pointer); });
    this.handle("window:widget-drag-move", pointerPositionSchema, (pointer) => { this.windows.moveWidgetDrag(pointer); });
    this.handle("window:widget-drag-end", z.unknown(), () => { this.windows.endWidgetDrag(); });
  }

  private handle<Input, Output>(channel: string, schema: z.ZodType<Input>, action: (input: Input) => Promise<Output> | Output): void {
    ipcMain.handle(`synapse:${channel}`, async (_event, raw: unknown) => {
      try { return { ok: true, value: await action(schema.parse(raw)) }; }
      catch (error) {
        const code = error instanceof DomainError ? error.code : error instanceof z.ZodError ? "INVALID_INPUT" : "INTERNAL_ERROR";
        const message = error instanceof Error ? error.message : String(error);
        this.container.logger.error("[synapse:ipc]", "request-failed", { channel, code, message });
        return { ok: false, error: { code, message } };
      }
    });
  }
}

function compactObject<T extends object>(input: object): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}
