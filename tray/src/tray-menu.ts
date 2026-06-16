/**
 * Tray icon + context menu controller.
 *
 * The menu is fully rebuilt on every state change — Electron does not support
 * partial menu updates and rebuilding is cheap. The menu reflects:
 *   - server lifecycle state (running, stopped, error, port-conflict, pre-flight failures)
 *   - smart search state (idle / building / ready / error) with note count
 *   - update availability (only shown when a newer version is on the registry)
 *   - autostart toggle
 */

import * as path from "node:path";
import {
  app,
  clipboard,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";
import { isAutostartEnabled, setAutostart } from "./autostart.js";
import { loadConfig, saveConfig } from "./config-store.js";
import { openPrefsWindow } from "./prefs-window.js";
import * as serverManager from "./server-manager.js";
import {
  connectionUrl as buildConnectionUrl,
  runningHeaderLabel,
  smartSearchLabel,
  smartSearchReadyNotificationBody,
  stoppedHeaderLabel,
} from "./tray-labels.js";
import { getLatestUpdate, onUpdateAvailable } from "./update-check.js";

const RELEASES_URL = "https://github.com/mkemeter/obsidian-vaultgate-mcp/releases";

let tray: Tray | undefined;
let copyFeedbackTimer: NodeJS.Timeout | undefined;
let copyLabel = "Copy Connection URL";

/** Resolves the icon asset directory (dev vs packaged). */
function assetDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", "dist", "assets");
  }
  return path.join(__dirname, "..", "assets");
}

/** Loads the platform-appropriate tray icon, falling back to an empty image. */
function loadTrayIcon(): Electron.NativeImage {
  const file =
    process.platform === "win32" ? "icon-win.ico" : "icon.png";
  const fullPath = path.join(assetDir(), file);
  const image = nativeImage.createFromPath(fullPath);
  if (process.platform === "darwin" && !image.isEmpty()) {
    image.setTemplateImage(true);
  }
  return image;
}

/** Returns the connection URL to copy to the clipboard, using the live config. */
function connectionUrl(): string {
  return buildConnectionUrl(loadConfig().port);
}

/** Builds the context menu template appropriate for the current state. */
function buildMenu(): Menu {
  const state = serverManager.getState();
  const isRunning = state === "running";
  const items: MenuItemConstructorOptions[] = [];

  // Header --------------------------------------------------------------------
  items.push({
    label: isRunning ? runningHeaderLabel(loadConfig().vault) : stoppedHeaderLabel(state),
    enabled: false,
  });
  items.push({ type: "separator" });

  // Connection URL ------------------------------------------------------------
  if (isRunning) {
    items.push({
      label: copyLabel,
      click: () => {
        clipboard.writeText(connectionUrl());
        copyLabel = "Copied!";
        rebuildMenu();
        if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = setTimeout(() => {
          copyLabel = "Copy Connection URL";
          rebuildMenu();
        }, 1500);
      },
    });
    items.push({ type: "separator" });

    // Smart search status -----------------------------------------------------
    items.push({ label: smartSearchLabel(serverManager.getIndexState()), enabled: false });
    items.push({ type: "separator" });

    items.push({ label: "Stop", click: () => void serverManager.stop() });
  } else {
    if (state === "obsidian-missing" || state === "cli-not-registered") {
      items.push({ label: "Open Preferences…", click: () => openPrefsWindow() });
    } else {
      items.push({ label: "Start", click: () => void serverManager.start() });
    }
  }

  items.push({ type: "separator" });

  // Diagnostics ---------------------------------------------------------------
  items.push({
    label: "Open Logs…",
    click: () => void shell.openPath(serverManager.getLogPath()),
  });
  items.push({ label: "Preferences…", click: () => openPrefsWindow() });

  items.push({ type: "separator" });

  // Autostart -----------------------------------------------------------------
  items.push({
    label: "Open at Login",
    type: "checkbox",
    checked: isAutostartEnabled(),
    click: (item) => setAutostart(item.checked),
  });

  // Update notice -------------------------------------------------------------
  const update = getLatestUpdate();
  if (update) {
    items.push({ type: "separator" });
    items.push({
      label: `Update available — v${update}`,
      click: () => void shell.openExternal(RELEASES_URL),
    });
  }

  items.push({ type: "separator" });
  items.push({ label: "Quit VaultGate", click: () => app.quit() });

  return Menu.buildFromTemplate(items);
}

/** Replaces the tray's context menu with a freshly rebuilt one. */
function rebuildMenu(): void {
  if (!tray) return;
  tray.setContextMenu(buildMenu());
}

/** Updates the tray tooltip to reflect the current connection URL. */
function updateTooltip(): void {
  if (!tray) return;
  const state = serverManager.getState();
  if (state === "running") {
    tray.setToolTip(`VaultGate — ${connectionUrl()}`);
  } else {
    tray.setToolTip("VaultGate");
  }
}

/**
 * Creates the tray icon, wires up event listeners, and renders the initial
 * menu. Must be called once after `app.whenReady()`.
 */
export function createTrayMenu(): void {
  tray = new Tray(loadTrayIcon());
  rebuildMenu();
  updateTooltip();

  serverManager.on("state", () => {
    rebuildMenu();
    updateTooltip();
  });

  serverManager.on("indexProgress", (event) => {
    rebuildMenu();
    if (event.state === "ready") notifySmartSearchReadyOnce(event.filesProcessed ?? 0);
  });

  onUpdateAvailable(() => rebuildMenu());
}

/** One-time native notification when the index first becomes ready. */
function notifySmartSearchReadyOnce(noteCount: number): void {
  const config = loadConfig();
  if (config.smartSearchReadyNotified) return;
  saveConfig({ smartSearchReadyNotified: true });
  if (!Notification.isSupported()) return;
  new Notification({
    title: "VaultGate",
    body: smartSearchReadyNotificationBody(noteCount),
    silent: true,
  }).show();
}
