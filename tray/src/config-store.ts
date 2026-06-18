/**
 * Config persistence + Obsidian / vault auto-detection.
 *
 * Stores user-editable settings (vault, port, obsidianPath) in
 * `userData/vaultgate-config.json`. Also exposes detection helpers used during
 * first-run setup (`detectObsidianPath`, `getRegisteredVaults`).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app } from "electron";

/** User-editable VaultGate settings persisted to disk. */
export interface VaultGateConfig {
  /** Obsidian vault name. Empty string = use the currently active vault. */
  vault: string;
  /** Local HTTP port for the bundled MCP server. */
  port: number;
  /** Absolute path to the Obsidian binary (CLI entry point). */
  obsidianPath: string;
  /** Whether the user has been notified once that the index is ready. */
  smartSearchReadyNotified: boolean;
}

/** A vault registered in Obsidian's `obsidian.json`. */
export interface RegisteredVault {
  /** Vault display name (folder basename). */
  name: string;
  /** Absolute path to the vault folder on disk. */
  path: string;
}

const DEFAULTS: VaultGateConfig = {
  vault: "",
  port: 3002,
  obsidianPath: "",
  smartSearchReadyNotified: false,
};

/** Resolves the absolute path to the persisted config JSON file. */
function configPath(): string {
  return path.join(app.getPath("userData"), "vaultgate-config.json");
}

/** Loads config from disk, merging missing keys with defaults. */
export function loadConfig(): VaultGateConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<VaultGateConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persists a partial config update; merges with whatever is already on disk. */
export function saveConfig(patch: Partial<VaultGateConfig>): void {
  const current = loadConfig();
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf-8");
}

/** Returns true if the user has saved any config (i.e. not first-run). */
export function hasConfig(): boolean {
  return fs.existsSync(configPath());
}

/**
 * Attempts to find Obsidian's binary at well-known locations.
 * Returns the empty string if nothing is found — the preferences window will
 * then prompt the user to locate it manually.
 */
export function detectObsidianPath(): string {
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    // Homebrew ARM64 (Apple Silicon) is the most common dev install path — check first
    candidates.push(
      "/opt/homebrew/bin/obsidian",
      "/Applications/Obsidian.app/Contents/MacOS/obsidian"
    );
  } else {
    // Linux: tray app is unsupported, but allow detection for dev runs
    candidates.push("/usr/bin/obsidian", "/usr/local/bin/obsidian");
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * Reads Obsidian's `obsidian.json` to enumerate vaults the user has opened.
 * Returns an empty array if the file is missing or unparseable — callers
 * should fall back to a free-text vault input.
 */
export function getRegisteredVaults(): RegisteredVault[] {
  const home = os.homedir();
  const platformPaths: Record<string, string> = {
    darwin: path.join(home, "Library/Application Support/obsidian/obsidian.json"),
    linux: path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "obsidian/obsidian.json"),
  };
  const filePath = platformPaths[process.platform];
  if (!filePath) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      vaults?: Record<string, { path: string }>;
    };
    if (!raw.vaults) return [];
    return Object.values(raw.vaults).map((v) => ({
      name: path.basename(v.path),
      path: v.path,
    }));
  } catch {
    return [];
  }
}
