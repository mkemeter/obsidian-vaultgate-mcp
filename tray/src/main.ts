/**
 * VaultGate tray app entry point.
 *
 * Startup sequence (per the plan, lines 601–615):
 *   1. requestSingleInstanceLock — only one tray instance per machine
 *   2. dock.hide on macOS (LSUIElement is the primary lever; this is belt-and-suspenders)
 *   3. App-ready: register IPC, run vault auto-detection, start server
 *   4. Create tray icon and wire state listeners
 *   5. Update check (non-blocking)
 *   6. First-connection notification (one-time)
 */

import { app, Notification } from "electron";
import { autoDetectFirstRun } from "./auto-detect.js";
import { hasConfig, loadConfig } from "./config-store.js";
import { openPrefsWindow, registerPrefsIpc } from "./prefs-window.js";
import * as serverManager from "./server-manager.js";
import { createTrayMenu } from "./tray-menu.js";
import { checkOnce } from "./update-check.js";

// 1. Single-instance lock --------------------------------------------------
// If another tray instance is already running, exit immediately. Without this
// we would end up with duplicate tray icons and competing server processes.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// 2. macOS: no Dock icon ---------------------------------------------------
// `LSUIElement: true` in Info.plist is the canonical path; `app.dock?.hide()`
// covers dev-mode runs where the .app wrapper is not present.
if (process.platform === "darwin") {
  app.dock?.hide();
}

void app.whenReady().then(async () => {
  // 3. App-ready ----------------------------------------------------------
  registerPrefsIpc();
  const isFirstLaunch = !hasConfig();
  autoDetectFirstRun();

  // Start the server before creating the tray so the initial menu reflects
  // the real lifecycle state instead of a brief "Stopped" flash.
  await serverManager.start();

  // 4. Tray ---------------------------------------------------------------
  createTrayMenu();

  // If pre-flight failed, surface preferences immediately so the user can fix things.
  const state = serverManager.getState();
  if (state === "obsidian-missing" || state === "cli-not-registered") {
    openPrefsWindow();
  }

  // 5. Update check (silent, non-blocking) -------------------------------
  void checkOnce();

  // 6. First-launch notification (one-time per install) -------------------
  if (isFirstLaunch) {
    const config = loadConfig();
    if (Notification.isSupported()) {
      new Notification({
        title: "VaultGate",
        body: config.vault
          ? `VaultGate is running — using vault: ${config.vault}`
          : "VaultGate is running.",
        silent: true,
      }).show();
    }
  }
});

// Quit cleanly: stop the server, then let Electron tear down. ----------------
app.on("before-quit", async (event) => {
  if (serverManager.getState() === "stopped" || serverManager.getState() === "idle") return;
  event.preventDefault();
  await serverManager.stop();
  app.exit(0);
});

// macOS: keep running with no windows open (we are a tray-only app). ---------
app.on("window-all-closed", () => {
  // Intentionally left blank — closing the prefs window must not quit the app.
});
