/**
 * Validation of Preferences config patches at the IPC boundary.
 *
 * Kept in its own module so it can be unit-tested without Electron. The
 * renderer (`prefs.js`) duplicates lightweight checks for instant feedback,
 * but the IPC handler is the last line of defence against a hand-edited or
 * corrupted config (or a buggy future renderer): e.g. an invalid `port`
 * persisted here would make the server's `loadConfig()` throw at startup →
 * 3 rapid crashes → tray stuck in `error`.
 */

import type { VaultGateConfig } from "./config-store.js";
import { isValidContextFileName, normalizeContextFileName } from "./context-file.js";
import { isValidInterval, MAX_INJECT_INTERVAL, MIN_INJECT_INTERVAL } from "./inject-interval.js";

/** Port range enforced by the tray — matches the Preferences UI (prefs.html). */
export const MIN_TRAY_PORT = 1024;
export const MAX_TRAY_PORT = 65535;

/**
 * Validates a renderer config patch before it is persisted.
 *
 * Deliberate divergence from the server: the headless npm server accepts
 * ports 1–65535, while the tray enforces 1024–65535 (matching the UI) because
 * ports below 1024 require elevated privileges.
 *
 * @param patch  Config patch from the renderer — any field may be absent.
 *               IPC payloads are untyped at runtime, so every present field
 *               is type-checked here, not just range-checked.
 * @returns A copy of the patch with `contextFileName` normalised (trimmed;
 *          empty → default), ready to persist.
 * @throws Error with a human-readable message when the patch is invalid.
 */
export function validateConfigPatch(patch: Partial<VaultGateConfig>): Partial<VaultGateConfig> {
  if (patch.port !== undefined) {
    if (!Number.isInteger(patch.port) || patch.port < MIN_TRAY_PORT || patch.port > MAX_TRAY_PORT) {
      throw new Error(
        `Invalid port ${String(patch.port)} — must be an integer between ${MIN_TRAY_PORT} and ${MAX_TRAY_PORT}.`
      );
    }
  }
  if (patch.contextFileName !== undefined && !isValidContextFileName(patch.contextFileName)) {
    throw new Error(
      `Invalid conventions filename ${JSON.stringify(patch.contextFileName)} — ` +
        "use a bare .md filename in the vault root (no paths)."
    );
  }
  if (patch.injectIntervalSecs !== undefined && !isValidInterval(patch.injectIntervalSecs)) {
    throw new Error(
      `Invalid injection interval ${String(patch.injectIntervalSecs)} — must be an integer ` +
        `between ${MIN_INJECT_INTERVAL} and ${MAX_INJECT_INTERVAL} seconds.`
    );
  }
  if (patch.obsidianPath !== undefined) {
    if (typeof patch.obsidianPath !== "string" || patch.obsidianPath.trim() === "") {
      throw new Error("Invalid Obsidian path — must be a non-empty string.");
    }
  }

  const normalized: Partial<VaultGateConfig> = { ...patch };
  if (patch.contextFileName !== undefined) {
    normalized.contextFileName = normalizeContextFileName(patch.contextFileName);
  }
  return normalized;
}
