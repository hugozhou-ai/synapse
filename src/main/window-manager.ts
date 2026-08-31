import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from "electron";
import { join } from "node:path";
import type { HookManagementService } from "@application/hook-management";
import type { SettingsApplicationService } from "@application/query-services";
import type { Logger } from "@shared/logger";
import { resolveRendererUrl } from "./renderer-url";
import { resolveWidgetPlacement } from "./widget-placement";

type WorkspaceRoute = "queue" | "history" | "settings" | `summary/${string}`;

export class ElectronWindowManager {
  private widget: BrowserWindow | null = null;
  private workspace: BrowserWindow | null = null;
  private tray: Tray | null = null;

  constructor(
    private readonly settings: SettingsApplicationService,
    private readonly hookManagement: HookManagementService,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    const settings = await this.settings.read();
    this.widget = this.createWindow({ width: 380, height: 88, transparent: true, backgroundColor: "#00000000", frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true });
    this.widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.widget.setAlwaysOnTop(true, "floating");
    this.placeWidget(settings.widgetPositions, settings.widgetDisplayId);
    await this.load(this.widget, "widget");
    if (settings.widgetVisible) this.widget.showInactive();
    this.createTray();
    try {
      const hooks = await this.hookManagement.inspect();
      if (!hooks.installed) this.logger.error("[synapse:hook]", "session-awareness-disabled", { message: hooks.message ?? "Hook is not installed." });
      if (hooks.onboardingRequired) {
        this.logger.info("[synapse:hook]", "setup-onboarding-opened", {});
        await this.openSettings();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("[synapse:hook]", "installation-status-inspection-failed", { message });
      await this.openSettings();
    }
  }

  async openHistory(): Promise<void> { await this.openWorkspace("history"); }

  async openSettings(): Promise<void> { await this.openWorkspace("settings"); }

  async openQueue(): Promise<void> { await this.openWorkspace("queue"); }

  async openSummary(sessionId: string): Promise<void> { await this.openWorkspace(`summary/quick/${sessionId}`); }

  private async openWorkspace(route: WorkspaceRoute): Promise<void> {
    if (!this.workspace || this.workspace.isDestroyed()) {
      this.workspace = this.createWindow({ width: 1180, height: 760, minWidth: 900, minHeight: 620, titleBarStyle: "hiddenInset", backgroundColor: "#fafaf7" });
      this.workspace.on("closed", () => { this.workspace = null; });
      await this.load(this.workspace, route);
    } else {
      this.workspace.webContents.send("synapse:navigate", route);
    }
    this.workspace.show(); this.workspace.focus();
  }

  broadcastSessionsChanged(): void {
    for (const window of [this.widget, this.workspace]) if (window && !window.isDestroyed()) window.webContents.send("synapse:sessions-changed");
  }

  resizeWidget(expanded: boolean): void { this.widget?.setSize(380, expanded ? 390 : 88, true); }

  private createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    const window = new BrowserWindow({
      ...options,
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      this.logger.error("[synapse:renderer]", "preload-failed", { preloadPath, message: error.message, stack: error.stack ?? null });
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      this.logger.error("[synapse:renderer]", "page-load-failed", { errorCode, errorDescription, validatedURL, isMainFrame });
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      this.logger.error("[synapse:renderer]", "process-gone", details);
    });
    return window;
  }

  private async load(window: BrowserWindow, route: string): Promise<void> {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) await window.loadURL(resolveRendererUrl(rendererUrl, route));
    else await window.loadFile(join(__dirname, "../renderer/index.html"), { hash: `/${route}` });
  }

  private placeWidget(positions: Readonly<Record<string, { x: number; y: number }>>, displayId: string | null): void {
    if (!this.widget) return;
    const primary = screen.getPrimaryDisplay();
    const placement = resolveWidgetPlacement(screen.getAllDisplays(), primary.id, displayId, positions, this.widget.getBounds());
    let currentPositions = { ...positions };
    this.widget.setPosition(placement.x, placement.y);
    let timer: NodeJS.Timeout | null = null;
    this.widget.on("move", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const [x = 0, y = 0] = this.widget!.getPosition();
        const currentDisplay = screen.getDisplayMatching(this.widget!.getBounds());
        currentPositions = { ...currentPositions, [String(currentDisplay.id)]: { x, y } };
        void this.settings.update({ widgetPositions: currentPositions, widgetDisplayId: String(currentDisplay.id) });
      }, 300);
    });
  }

  private createTray(): void {
    const image = nativeImage.createFromNamedImage("NSActionTemplate").resize({ width: 16, height: 16 });
    image.setTemplateImage(true);
    this.tray = new Tray(image);
    this.tray.setToolTip("Synapse");
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开历史与总结", click: () => void this.openHistory() },
      { label: "打开设置", click: () => void this.openSettings() },
      { label: "显示挂件", type: "checkbox", checked: this.widget?.isVisible() ?? true, click: (item) => { if (item.checked) this.widget?.showInactive(); else this.widget?.hide(); void this.settings.update({ widgetVisible: item.checked }); } },
      { type: "separator" },
      { label: "退出 Synapse", click: () => app.quit() },
    ]));
    this.tray.on("click", () => {
      const visible = !(this.widget?.isVisible() ?? false);
      if (visible) this.widget?.showInactive(); else this.widget?.hide();
      void this.settings.update({ widgetVisible: visible });
    });
  }
}
