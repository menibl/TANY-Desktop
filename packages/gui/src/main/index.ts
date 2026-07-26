import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import * as path from "path";
import { registerIpcHandlers } from "./ipc";
import { getOrCreateDevice } from "@tany-desktop/shared";
import { cancelAllLoginSessions } from "@tany-desktop/engine-web";

/**
 * Single-instance lock + "closing the window just hides it" (tray icon
 * stays, MCP server keeps serving if it was started) is the whole point
 * of the packaged app's UX: download, configure routines, click "הפעל
 * שירות" once, close the window - it keeps running in the background.
 * Reopening the app (double-clicking the exe/shortcut again, or the tray
 * icon) brings the same window back instead of starting a second copy.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "TANY DESKTOP",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "index.html"));

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    // Minimize-to-tray instead of actually closing: the whole point is that
    // whatever the user started (the MCP server) keeps running after the
    // window goes away, exactly like any other tray-resident app.
    event.preventDefault();
    mainWindow?.hide();
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "..", "assets", "tray-icon.png"));
  tray = new Tray(icon);
  tray.setToolTip("TANY DESKTOP");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "פתח TANY DESKTOP", click: showMainWindow },
      { type: "separator" },
      {
        label: "יציאה",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showMainWindow);
}

app.whenReady().then(() => {
  getOrCreateDevice(); // ensure identity exists before any IPC call needs it
  registerIpcHandlers();
  createWindow();
  createTray();

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("second-instance", () => {
  showMainWindow();
});

// Don't quit on window close - see mainWindow's "close" handler above. This
// only matters for platforms/cases where a window is actually destroyed
// without going through that handler.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  void cancelAllLoginSessions();
});
