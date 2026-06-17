/**
 * Preferences BrowserWindow controller.
 *
 * Owns IPC handler registration (one-shot at app start) and the show/hide
 * lifecycle of the single preferences window. Saving from the renderer
 * triggers a server restart so config changes (port, vault, etc.) take effect.
 */

import * as path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { isAutostartEnabled, setAutostart } from "./autostart.js";
import {
  detectObsidianPath,
  getRegisteredVaults,
  loadConfig,
  saveConfig,
  type VaultGateConfig,
} from "./config-store.js";
import * as serverManager from "./server-manager.js";
import { findFreePort } from "./port-utils.js";

let prefsWindow: BrowserWindow | undefined;

/** Resolves the renderer asset directory (dev vs packaged). */
function rendererDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", "dist", "renderer");
  }
  return path.join(__dirname, "..", "renderer");
}

/** Registers all `prefs:*` IPC handlers exactly once. */
export function registerPrefsIpc(): void {
  ipcMain.handle("prefs:loadConfig", () => loadConfig());
  ipcMain.handle("prefs:saveConfig", async (_event, patch: Partial<VaultGateConfig>) => {
    saveConfig(patch);
    // Restart the server so port/vault/path changes take effect immediately.
    await serverManager.restart();
  });
  ipcMain.handle("prefs:listVaults", () => getRegisteredVaults());
  ipcMain.handle("prefs:detectObsidianPath", () => detectObsidianPath());
  ipcMain.handle("prefs:suggestPort", () => findFreePort(loadConfig().port));
  ipcMain.handle("prefs:checkPort", async (_event, port: number) => {
    return serverManager.checkPortAvailability(port);
  });
  ipcMain.handle("prefs:pickObsidianPath", async () => {
    const result = await dialog.showOpenDialog({
      title: "Locate Obsidian",
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return undefined;
    return result.filePaths[0];
  });
  ipcMain.handle("prefs:isAutostartEnabled", () => isAutostartEnabled());
  ipcMain.handle("prefs:setAutostart", (_event, enabled: boolean) => setAutostart(enabled));
  ipcMain.handle("prefs:getServerState", () => serverManager.getState());
  ipcMain.on("prefs:close", () => prefsWindow?.close());
}

/** Opens (or focuses) the Preferences window. */
export function openPrefsWindow(): void {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.focus();
    return;
  }

  prefsWindow = new BrowserWindow({
    width: 420,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "VaultGate — Preferences",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  prefsWindow.removeMenu();
  void prefsWindow.loadFile(path.join(rendererDir(), "prefs.html"));
  prefsWindow.once("ready-to-show", () => prefsWindow?.show());
  prefsWindow.on("closed", () => {
    prefsWindow = undefined;
  });
}
