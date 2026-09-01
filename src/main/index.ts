import { app } from "electron";
import { ElectronApplicationContainer } from "./container";
import { ElectronIpcController } from "./ipc-controller";
import { ElectronWindowManager } from "./window-manager";

app.setName("Synapse");

let container: ElectronApplicationContainer | null = null;
let windows: ElectronWindowManager | null = null;
let quitting = false;

app.whenReady().then(async () => {
  container = await ElectronApplicationContainer.create(
    app,
    () => windows?.broadcastSessionsChanged(),
    (activity) => windows?.broadcastSummaryActivity(activity),
  );
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
