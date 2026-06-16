/**
 * Cross-platform autostart toggle.
 *
 * Electron's `app.setLoginItemSettings()` handles platform differences:
 *   macOS 13+ → SMAppService entry under System Settings → Login Items
 *   macOS ≤12 → LSSharedFileList
 *   Windows   → HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 *
 * `openAsHidden: true` keeps the app silent on launch — the tray icon
 * appears, but no window opens.
 */

import { app } from "electron";

/** Enables or disables launching VaultGate at user login. */
export function setAutostart(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
}

/** Returns the current autostart state as the OS reports it. */
export function isAutostartEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
