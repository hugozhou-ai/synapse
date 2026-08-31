import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from "electron";
import { join } from "node:path";
import type { HookManagementService } from "@application/hook-management";
import type { SettingsApplicationService } from "@application/query-services";
import type { Logger } from "@shared/logger";
import { resolveWidgetBounds, WIDGET_COLLAPSED_SIZE, type WidgetBounds } from "@shared/widget-layout";
import { resolveRendererUrl } from "./renderer-url";
import { resolveAnchoredWidgetBounds, resolveWidgetPlacement } from "./widget-placement";
import { WorkspaceDockController } from "./workspace-dock";

type WorkspaceRoute = "queue" | "history" | "settings" | `history/${string}` | `summary/${string}`;
interface WidgetAnchor { readonly displayId: string; readonly right: number; readonly y: number; }
interface WidgetDragOrigin { readonly pointerX: number; readonly pointerY: number; readonly windowX: number; readonly windowY: number; }

export class ElectronWindowManager {
  private widget: BrowserWindow | null = null;
  private workspace: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private widgetAnchor: WidgetAnchor | null = null;
  private widgetDragOrigin: WidgetDragOrigin | null = null;
  private readonly workspaceDock: WorkspaceDockController;

  constructor(
    private readonly settings: SettingsApplicationService,
    private readonly hookManagement: HookManagementService,
    private readonly logger: Logger,
  ) {
    this.workspaceDock = new WorkspaceDockController(this.resolveWorkspaceDock());
  }

  async start(): Promise<void> {
    const settings = await this.settings.read();
    const collapsedBounds = resolveWidgetBounds("collapsed", 0);
    this.configureDevelopmentDockIcon();
    this.workspaceDock.hide();
    this.widget = this.createWindow({ width: collapsedBounds.width, height: collapsedBounds.height, transparent: true, backgroundColor: "#00000000", frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true });
    this.widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.widget.setAlwaysOnTop(true, "floating");
    this.widget.on("blur", () => this.dismissWidget());
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

  async openSummaryResult(documentId: string): Promise<void> { await this.openWorkspace(`history/${documentId}`); }

  async openSummary(sessionId: string): Promise<void> { await this.openWorkspace(`summary/${sessionId}`); }

  private async openWorkspace(route: WorkspaceRoute): Promise<void> {
    if (!this.workspace || this.workspace.isDestroyed()) {
      await this.workspaceDock.show();
      this.workspace = this.createWindow({ width: 1180, height: 760, minWidth: 900, minHeight: 620, titleBarStyle: "hiddenInset", backgroundColor: "#fafaf7" });
      this.workspace.on("closed", () => {
        this.workspace = null;
        this.workspaceDock.hide();
      });
      await this.load(this.workspace, route);
    } else {
      this.workspace.webContents.send("synapse:navigate", route);
    }
    this.workspace.show(); this.workspace.focus();
  }

  broadcastSessionsChanged(): void {
    for (const window of [this.widget, this.workspace]) if (window && !window.isDestroyed()) window.webContents.send("synapse:sessions-changed");
  }

  resizeWidget(size: WidgetBounds): void {
    if (!this.widget) return;
    const current = this.widget.getBounds();
    const displays = screen.getAllDisplays();
    const display = displays.find((candidate) => String(candidate.id) === this.widgetAnchor?.displayId) ?? screen.getDisplayMatching(current);
    const anchor = this.widgetAnchor ?? { displayId: String(display.id), right: current.x + current.width, y: current.y };
    this.widget.setBounds(resolveAnchoredWidgetBounds(display.workArea, anchor, size), true);
  }

  beginWidgetDrag(pointer: { x: number; y: number }): void {
    if (!this.widget || this.widget.getBounds().width !== WIDGET_COLLAPSED_SIZE) return;
    const [windowX = 0, windowY = 0] = this.widget.getPosition();
    this.widgetDragOrigin = { pointerX: pointer.x, pointerY: pointer.y, windowX, windowY };
  }

  moveWidgetDrag(pointer: { x: number; y: number }): void {
    if (!this.widget || !this.widgetDragOrigin) return;
    const display = screen.getDisplayNearestPoint({ x: Math.round(pointer.x), y: Math.round(pointer.y) });
    const size = this.widget.getBounds();
    const desiredX = Math.round(this.widgetDragOrigin.windowX + pointer.x - this.widgetDragOrigin.pointerX);
    const desiredY = Math.round(this.widgetDragOrigin.windowY + pointer.y - this.widgetDragOrigin.pointerY);
    const maxX = Math.max(display.workArea.x, display.workArea.x + display.workArea.width - size.width);
    const maxY = Math.max(display.workArea.y, display.workArea.y + display.workArea.height - size.height);
    const x = Math.min(maxX, Math.max(display.workArea.x, desiredX));
    const y = Math.min(maxY, Math.max(display.workArea.y, desiredY));
    this.widgetAnchor = { displayId: String(display.id), right: x + size.width, y };
    this.widget.setPosition(x, y);
  }

  endWidgetDrag(): void { this.widgetDragOrigin = null; }

  dismissWidget(): void { this.widget?.webContents.send("synapse:widget-blur"); }

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
    const displays = screen.getAllDisplays();
    const placement = resolveWidgetPlacement(displays, primary.id, displayId, positions, this.widget.getBounds());
    let currentPositions = { ...positions };
    this.widgetAnchor = { displayId: placement.displayId, right: placement.x + this.widget.getBounds().width, y: placement.y };
    this.widget.setPosition(placement.x, placement.y);
    let timer: NodeJS.Timeout | null = null;
    this.widget.on("move", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = this.widget!.getBounds();
        if (bounds.width !== WIDGET_COLLAPSED_SIZE) return;
        const currentDisplay = screen.getDisplayMatching(bounds);
        this.widgetAnchor = { displayId: String(currentDisplay.id), right: bounds.x + bounds.width, y: bounds.y };
        currentPositions = { ...currentPositions, [String(currentDisplay.id)]: { x: bounds.x, y: bounds.y } };
        void this.settings.update({ widgetPositions: currentPositions, widgetDisplayId: String(currentDisplay.id) });
      }, 300);
    });
  }

  private createTray(): void {
    const trayIconPath = app.isPackaged
      ? join(process.resourcesPath, "resources", "SynapseStatusTemplate.png")
      : join(app.getAppPath(), "resources", "SynapseStatusTemplate.png");
    const image = nativeImage.createFromPath(trayIconPath);
    const retinaImage = nativeImage.createFromPath(trayIconPath.replace(/\.png$/, "@2x.png"));
    if (image.isEmpty() || retinaImage.isEmpty()) throw new Error(`Unable to load status bar icon at ${trayIconPath}.`);
    image.addRepresentation({ scaleFactor: 2, dataURL: retinaImage.toDataURL() });
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

  private configureDevelopmentDockIcon(): void {
    if (process.platform !== "darwin" || app.isPackaged) return;
    const dock = this.resolveWorkspaceDock();
    if (!dock) throw new Error("Unable to configure the Dock icon because the Dock API is unavailable.");
    const dockIconPath = join(app.getAppPath(), "build", "icon-master.png");
    const image = nativeImage.createFromPath(dockIconPath);
    if (image.isEmpty()) throw new Error(`Unable to load Dock icon at ${dockIconPath}.`);
    dock.setIcon(image);
  }

  private resolveWorkspaceDock(): Electron.Dock | null {
    if (process.platform !== "darwin") return null;
    if (!app.dock) throw new Error("Unable to manage the Dock icon because the Dock API is unavailable.");
    return app.dock;
  }
}
