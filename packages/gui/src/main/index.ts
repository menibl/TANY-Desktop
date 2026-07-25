import { app, BrowserWindow } from "electron";
import * as path from "path";
import { registerIpcHandlers } from "./ipc";
import { getOrCreateDevice } from "@tany-desktop/shared";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "TANY DESKTOP",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "..", "src", "renderer", "index.html"));
}

app.whenReady().then(() => {
  getOrCreateDevice(); // ensure identity exists before any IPC call needs it
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
