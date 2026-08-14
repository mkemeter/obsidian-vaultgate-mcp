/**
 * Tray icon + context menu controller.
 *
 * The menu is fully rebuilt on every state change — Electron does not support
 * partial menu updates and rebuilding is cheap. The menu reflects:
 *   - server lifecycle state (running, stopped, error, port-conflict, pre-flight failures)
 *   - smart search state (idle / building / ready / error) with note count
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
import { loadConfig, saveConfig } from "./config-store.js";
import { openPrefsWindow } from "./prefs-window.js";
import * as serverManager from "./server-manager.js";
import {
  appHeaderLabel,
  connectionUrl as buildConnectionUrl,
  runningHeaderLabel,
  smartSearchLabel,
  smartSearchReadyNotificationBody,
  stoppedHeaderLabel,
} from "./tray-labels.js";

let tray: Tray | undefined;
let copyFeedbackTimer: NodeJS.Timeout | undefined;
let copyLabel = "Copy URL";

/** Resolves the icon asset directory (dev vs packaged). */
function assetDir(): string {
  if (app.isPackaged) {
    // Icons are in extraResources → <resourcesPath>/assets/ (outside the asar)
    return path.join(process.resourcesPath, "assets");
  }
  return path.join(__dirname, "..", "assets");
}

/** Loads the tray icon, falling back to an empty image. */
function loadTrayIcon(): Electron.NativeImage {
  const file = "icon.png";
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

  const copyUrlItem: MenuItemConstructorOptions = {
    label: copyLabel,
    click: () => {
      clipboard.writeText(connectionUrl());
      copyLabel = "Copied!";
      rebuildMenu();
      if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(() => {
        copyLabel = "Copy URL";
        rebuildMenu();
      }, 1500);
    },
  };

  // Zone 1: identity + status ------------------------------------------------
  items.push({ label: appHeaderLabel(app.getVersion()), enabled: false });
  items.push({ type: "separator" });
  if (isRunning) {
    items.push({
      label: runningHeaderLabel(loadConfig().vault),
      submenu: [copyUrlItem, { label: "Stop", click: () => void serverManager.stop() }],
    });
    const indexEvt = serverManager.getIndexState();
    const isBuilding = indexEvt.state === "building";
    items.push({
      label: smartSearchLabel(indexEvt),
      submenu: [
        {
          label: "Rebuild index",
          enabled: !isBuilding,
          click: () => serverManager.sendControlCommand("rebuild_index"),
        },
        {
          label: "Clear cache && rebuild",
          enabled: !isBuilding,
          click: () => serverManager.sendControlCommand("clear_index"),
        },
      ],
    });
  } else {
    const canStart =
      state !== "starting" && state !== "obsidian-missing" && state !== "port-conflict";
    items.push({
      label: stoppedHeaderLabel(state, loadConfig().port),
      submenu: [
        copyUrlItem,
        ...(canStart ? [{ label: "Start", click: () => void serverManager.start() }] : []),
      ],
    });
  }

  // Zone 2: utilities --------------------------------------------------------
  items.push({ type: "separator" });
  items.push({ label: "Logs", click: () => void shell.openPath(serverManager.getLogPath()) });
  items.push({ label: "Preferences", click: () => openPrefsWindow() });
  items.push({
    label: "GitHub",
    click: () => void shell.openExternal("https://github.com/mkemeter/obsidian-vaultgate-mcp"),
  });
  items.push({ type: "separator" });
  items.push({ label: "Quit", click: () => app.quit() });

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
