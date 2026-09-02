import { app, dialog } from "electron";
import { ElectronApplicationContainer } from "./container";
import { isInstallerVolumeExecutable } from "./installation-location";
import { ElectronIpcController } from "./ipc-controller";
import { ElectronWindowManager } from "./window-manager";

app.setName("Synapse");

let container: ElectronApplicationContainer | null = null;
let windows: ElectronWindowManager | null = null;
let quitting = false;

app.whenReady().then(async () => {
  if (app.isPackaged && isInstallerVolumeExecutable(process.execPath)) {
    console.error(`[synapse:install-location] ${JSON.stringify({ executablePath: process.execPath })}`);
    dialog.showMessageBoxSync({
      type: "warning",
      title: "请先安装 Synapse",
      message: "Synapse 正在从安装镜像运行",
      detail: "请将 Synapse 拖入“应用程序”文件夹，弹出安装镜像，然后从“应用程序”启动。",
      buttons: ["退出"],
      defaultId: 0,
    });
    app.quit();
    return;
  }

  container = await ElectronApplicationContainer.create(app, () => windows?.broadcastSessionsChanged());
  container.logger.info("[synapse:main]", "application-starting", { version: app.getVersion(), packaged: app.isPackaged });
  windows = new ElectronWindowManager(container.settings, container.hookManagement, container.logger);
  new ElectronIpcController(container, windows).register();
  await container.hookReceiver.start();
  container.notesWorker.start();
  await windows.start();
  container.logger.info("[synapse:main]", "application-ready", {});
  app.on("activate", () => { void windows?.openHistory(); });
}).catch((error) => {
  console.error(`[synapse:main] startup-failed ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}`);
  app.quit();
});

app.on("window-all-closed", () => { /* Keep the tray application alive on macOS. */ });
app.on("before-quit", (event) => {
  if (quitting || !container) return;
  event.preventDefault(); quitting = true;
  container.logger.info("[synapse:main]", "application-stopping", {});
  void container.close().finally(() => app.quit());
});
