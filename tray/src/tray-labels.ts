/**
 * Pure label-generation helpers for the tray context menu.
 *
 * These are extracted from `tray-menu.ts` so the formatting logic — which is
 * the single largest source of user-visible behaviour in the tray — is fully
 * unit-testable without standing up an Electron `Menu` / `Tray`. Each function
 * is a pure mapping from inputs to a string; the caller provides whatever
 * state it has read from elsewhere.
 *
 * Keeping these out of `tray-menu.ts` lets that file stay excluded from
 * coverage while every label transition still gets a test.
 */

import type { IndexProgressEvent, ServerState } from "./server-manager.js";

/** Returns the connection URL to copy to the clipboard. */
export function connectionUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** Pretty-prints the smart-search row label for the current index state. */
export function smartSearchLabel(ev: IndexProgressEvent): string {
  if (ev.state === "ready") {
    const n = ev.filesProcessed ?? 0;
    return `✓ Smart search ready — ${n} note${n === 1 ? "" : "s"}`;
  }
  if (ev.state === "building") {
    if (
      typeof ev.filesProcessed === "number" &&
      typeof ev.totalFiles === "number" &&
      ev.totalFiles > 0
    ) {
      return `○ Building index (${ev.filesProcessed}/${ev.totalFiles})…`;
    }
    return "○ Building index…";
  }
  if (ev.state === "error") return "✗ Smart search index error";
  return "○ Smart search warming up…";
}

/** Returns the running-state header label including the active vault name. */
export function runningHeaderLabel(vaultName: string): string {
  const display = vaultName || "Active vault";
  return `● Running — ${display}`;
}

/** Returns the stopped/error state header label. */
export function stoppedHeaderLabel(state: ServerState, port?: number): string {
  switch (state) {
    case "error":
      return "○ Error — server crashed";
    case "port-conflict":
      return port !== undefined
        ? `○ Port ${port} in use — change in Preferences`
        : "○ Error — port already in use";
    case "obsidian-missing":
      return "○ Obsidian not found";
    case "starting":
      return "● Starting…";
    default:
      return "○ Stopped";
  }
}

/** Returns the human-readable noun for the body of the first-launch notification. */
export function smartSearchReadyNotificationBody(noteCount: number): string {
  return `Smart search is ready (${noteCount} note${noteCount === 1 ? "" : "s"} indexed).`;
}
