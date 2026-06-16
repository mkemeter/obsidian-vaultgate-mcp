/**
 * Lightweight, opt-in update check.
 *
 * Compares the locally installed version with the latest version on the npm
 * registry (the source of truth — npm publishes always lead the GitHub
 * release). Failure is silent: corporate proxies, no network, or registry
 * rate limits should never bother the user.
 *
 * No `electron-updater`, no auto-install. The tray menu surfaces a single
 * "Update available — vX.Y.Z" item that links to the GitHub releases page.
 */

import { app } from "electron";

const REGISTRY_URL = "https://registry.npmjs.org/obsidian-vaultgate-mcp/latest";
const TIMEOUT_MS = 3000;

let latestUpdate: string | undefined;
type Listener = (version: string) => void;
const listeners = new Set<Listener>();

/** Subscribe to "update available" notifications. Returns an unsubscriber. */
export function onUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener);
  if (latestUpdate) listener(latestUpdate);
  return () => listeners.delete(listener);
}

/** Returns the latest seen update version, or `undefined` if none detected. */
export function getLatestUpdate(): string | undefined {
  return latestUpdate;
}

/** Naive semver comparison — returns true if `a` is newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      ?.split(".")
      .map((n) => Number.parseInt(n, 10) || 0) ?? [];
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

/**
 * Performs a single update check. Safe to call on startup; never throws.
 * Notifies subscribers if a newer version is available.
 */
export async function checkOnce(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const json = (await res.json()) as { version?: string };
    if (!json.version) return;
    if (isNewer(json.version, app.getVersion())) {
      latestUpdate = json.version;
      for (const listener of listeners) listener(json.version);
    }
  } catch {
    /* network failure / abort — silent */
  }
}
