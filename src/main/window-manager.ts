import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from "electron";
import { join } from "node:path";
import type { SettingsApplicationService } from "@application/query-services";

export class ElectronWindowManager {
  private widget: BrowserWindow | null = null;
  private workspace: BrowserWindow | null = null;
  private tray: Tray | null = null;

  constructor(private readonly settings: SettingsApplicationService) {}

  async start(): Promise<void> {
    const settings = await this.settings.read();
    this.widget = this.createWindow({ width: 380, height: 88, transparent: true, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true });
    this.widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.widget.setAlwaysOnTop(true, "floating");
    this.placeWidget(settings.widgetPositions);
    await this.load(this.widget, "widget");
    if (settings.widgetVisible) this.widget.showInactive();
    this.createTray();
  }

  async openHistory(): Promise<void> {
    if (!this.workspace || this.workspace.isDestroyed()) {
      this.workspace = this.createWindow({ width: 1180, height: 760, minWidth: 900, minHeight: 620, titleBarStyle: "hiddenInset", backgroundColor: "#f4f1eb" });
      this.workspace.on("closed", () => { this.workspace = null; });
      await this.load(this.workspace, "history");
    }
    this.workspace.show(); this.workspace.focus();
  }

  async openSummary(sessionId: string): Promise<void> {
    await this.openHistory();
    this.workspace?.webContents.send("synapse:navigate", `summary/${sessionId}`);
  }

  broadcastSessionsChanged(): void {
    for (const window of [this.widget, this.workspace]) if (window && !window.isDestroyed()) window.webContents.send("synapse:sessions-changed");
  }

  resizeWidget(expanded: boolean): void { this.widget?.setSize(380, expanded ? 390 : 88, true); }

  private createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    return new BrowserWindow({
      ...options,
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  }

  private async load(window: BrowserWindow, route: string): Promise<void> {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) await window.loadURL(`${rendererUrl}#/${route}`);
    else await window.loadFile(join(__dirname, "../renderer/index.html"), { hash: `/${route}` });
  }

  private placeWidget(positions: Readonly<Record<string, { x: number; y: number }>>): void {
    if (!this.widget) return;
    const display = screen.getPrimaryDisplay(); const saved = positions[String(display.id)];
    let currentPositions = { ...positions };
    const bounds = display.workArea;
    this.widget.setPosition(saved?.x ?? bounds.x + bounds.width - 396, saved?.y ?? bounds.y + 16);
    let timer: NodeJS.Timeout | null = null;
    this.widget.on("move", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const [x = 0, y = 0] = this.widget!.getPosition();
        const currentDisplay = screen.getDisplayMatching(this.widget!.getBounds());
        currentPositions = { ...currentPositions, [String(currentDisplay.id)]: { x, y } };
        void this.settings.update({ widgetPositions: currentPositions });
      }, 300);
    });
  }

  private createTray(): void {
    const image = nativeImage.createFromNamedImage("NSActionTemplate");
    this.tray = new Tray(image);
    this.tray.setToolTip("Synapse");
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开历史与总结", click: () => void this.openHistory() },
      { label: "显示挂件", type: "checkbox", checked: this.widget?.isVisible() ?? true, click: (item) => { if (item.checked) this.widget?.showInactive(); else this.widget?.hide(); void this.settings.update({ widgetVisible: item.checked }); } },
      { type: "separator" },
      { label: "退出 Synapse", click: () => app.quit() },
    ]));
    this.tray.on("click", () => { if (this.widget?.isVisible()) this.widget.hide(); else this.widget?.showInactive(); });
  }
}
