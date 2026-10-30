import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeContextFileName } from "./config.js";

/**
 * Vault scopes — server-enforced partitioning of an Obsidian vault into named
 * zones. Notes outside the active scope are invisible to all tools.
 *
 * Configuration: drop a `.vaultgate` file (VaultGate-specific TOML subset) in
 * any directory to declare a scope for notes in that directory and below.
 * Nearest ancestor wins. Notes with no `.vaultgate` ancestor belong to the
 * built-in `"unscoped"` zone.
 *
 * Core invariant: notes from different scopes never appear in the same tool
 * result. Enforced here in server code, not by LLM instructions.
 *
 * Enabling: call `initScopeEngine()` with a valid vault path. All functions
 * are passthrough no-ops until that call succeeds (`isScopingEnabled()` returns
 * `false`). Vaults with no `.vaultgate` files behave identically to before.
 */

/** Parsed content of a single `.vaultgate` file. */
export interface VaultGateFile {
  /** Scope name for notes in this directory and below. */
  scope?: string;
  /** Optional scope-local conventions filename (bare `.md` name, vault-root). */
  conventions?: string;
}

/**
 * Map from normalized vault-relative directory path to the parsed `.vaultgate`
 * config for that directory. Only directories that contain a `.vaultgate` file
 * are present as keys.
 *
 * Paths are normalized: forward slashes, no leading `/`, trimmed.
 * The vault root is represented by an empty string `""`.
 */
type ScopeMap = Map<string, VaultGateFile>;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let scopeMap: ScopeMap = new Map();
let vaultRootPath: string | undefined;
let homeScope: string = "unscoped";
let activeScope: string = "unscoped";
let scopeSwitchingEnabled: boolean = false;
let enabled: boolean = false;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a vault-relative path: converts backslashes to forward slashes,
 * strips any leading `/`, and trims whitespace. The vault root is `""`.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

/**
 * Returns `true` if the path points to a `.vaultgate` configuration file.
 * These files must never be exposed to AI-visible operations regardless of
 * scope state.
 */
export function isVaultGateFile(notePath: string): boolean {
  const normalized = normalizePath(notePath);
  return normalized === ".vaultgate" || normalized.endsWith("/.vaultgate");
}

// ---------------------------------------------------------------------------
// .vaultgate parser
// ---------------------------------------------------------------------------

/** Maximum length (characters) for a scope name. Longer values are discarded. */
const MAX_SCOPE_NAME_LENGTH = 64;

/**
 * Parses a `.vaultgate` file from a string.
 *
 * Supports a minimal TOML subset: `key = "value"` lines only (quoted strings).
 * Lines starting with `#` are comments. Unknown keys are silently ignored.
 * Invalid values are discarded with a warning.
 */
export function parseVaultGateFile(content: string, filePath: string): VaultGateFile {
  const result: VaultGateFile = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(\w+)\s*=\s*"(.*)"/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    const trimmed = value.trim();
    if (key === "scope") {
      if (!trimmed) continue;
      if (trimmed.length > MAX_SCOPE_NAME_LENGTH) {
        console.error(
          `[VaultGate] scope.ts: scope name "${trimmed}" in ${filePath} exceeds ${MAX_SCOPE_NAME_LENGTH} chars — ignoring.`
        );
        continue;
      }
      result.scope = trimmed;
    } else if (key === "conventions") {
      try {
        result.conventions = normalizeContextFileName(trimmed);
      } catch {
        console.error(
          `[VaultGate] scope.ts: invalid conventions value "${trimmed}" in ${filePath} — ignoring.`
        );
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ScopeMap builder
// ---------------------------------------------------------------------------

/**
 * Recursively walks the vault filesystem, reads every `.vaultgate` file found,
 * and returns a `ScopeMap` (normalized dir path → parsed config).
 *
 * Non-existent or unreadable `.vaultgate` files are skipped silently.
 * Filesystem errors on subdirectory traversal are logged and skipped.
 */
export function buildScopeMap(vaultPath: string): ScopeMap {
  const map: ScopeMap = new Map();
  walkDir(vaultPath, vaultPath, map);
  return map;
}

function walkDir(vaultPath: string, dir: string, map: ScopeMap): void {
  const vaultGatePath = path.join(dir, ".vaultgate");
  if (fs.existsSync(vaultGatePath)) {
    try {
      const content = fs.readFileSync(vaultGatePath, "utf8");
      const parsed = parseVaultGateFile(content, vaultGatePath);
      const relDir = normalizePath(path.relative(vaultPath, dir));
      map.set(relDir, parsed);
    } catch (err) {
      console.error(`[VaultGate] scope.ts: failed to read ${vaultGatePath}: ${err}`);
    }
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[VaultGate] scope.ts: failed to read directory ${dir}: ${err}`);
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      walkDir(vaultPath, path.join(dir, entry.name), map);
    }
  }
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the scope for a vault-relative note path by walking up the
 * directory chain and returning the `scope` from the nearest ancestor
 * `.vaultgate` file. Returns `"unscoped"` when no ancestor declares a scope.
 *
 * For non-existent notes (e.g. `note_create` targets), resolution starts from
 * the note's parent directory — the note inherits its destination folder's scope.
 */
export function resolveNoteScope(notePath: string): string {
  if (!enabled) return "unscoped";
  const normalized = normalizePath(notePath);
  // Start from the parent directory of the note.
  let dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  // Walk up until we find a .vaultgate with a scope, or exhaust ancestors.
  while (true) {
    const entry = scopeMap.get(dir);
    if (entry?.scope) return entry.scope;
    if (dir === "") break;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
  return "unscoped";
}

/**
 * Returns `true` when the note belongs to the currently active scope.
 * Always returns `true` when scoping is disabled (passthrough).
 */
export function isNoteInScope(notePath: string): boolean {
  if (!enabled) return true;
  return resolveNoteScope(notePath) === activeScope;
}

/** Standard error message returned when a note path is blocked by scope enforcement. */
export const SCOPE_BLOCKED_MESSAGE = "This note is not accessible in the current scope.";

/**
 * Returns `true` when the given note path must be blocked from all AI-visible
 * operations. Two conditions trigger blocking:
 *
 * 1. The path resolves to a `.vaultgate` config file (always, even when scoping
 *    is disabled) — these files must never be AI-visible.
 * 2. When scoping is enabled, the note's scope does not match the active scope.
 *
 * Passing `undefined` (the active Obsidian file — unknown to VaultGate) always
 * returns `false`, allowing the call to proceed.
 *
 * @param notePath  Vault-relative note path, or `undefined`.
 */
export function isPathBlocked(notePath: string | undefined): boolean {
  if (notePath === undefined) return false;
  if (isVaultGateFile(notePath)) return true;
  return !isNoteInScope(notePath);
}

/**
 * Filters an array of vault-relative paths to those belonging to the active scope.
 * Returns the full array unchanged when scoping is disabled.
 */
export function filterByScope(paths: string[]): string[] {
  if (!enabled) return paths;
  return paths.filter((p) => resolveNoteScope(p) === activeScope);
}

/**
 * Returns all unique scope names declared across all `.vaultgate` files, plus
 * the always-present `"unscoped"` zone. The list is sorted alphabetically.
 */
export function discoverScopes(): string[] {
  const scopes = new Set<string>(["unscoped"]);
  for (const entry of scopeMap.values()) {
    if (entry.scope) scopes.add(entry.scope);
  }
  return [...scopes].sort();
}

/**
 * Returns the `conventions` filename for the currently active scope, or
 * `undefined` if:
 * - scoping is disabled,
 * - the active scope is `"unscoped"`,
 * - no `.vaultgate` file declares a `conventions` key for the active scope.
 *
 * When multiple directories share the same scope, the one with the shortest
 * (closest to vault root) path wins — deterministic, no ambiguity.
 */
export function getScopeConventionsFile(): string | undefined {
  if (!enabled || activeScope === "unscoped") return undefined;
  let best: { dir: string; conventions: string } | undefined;
  for (const [dir, entry] of scopeMap.entries()) {
    if (entry.scope === activeScope && entry.conventions) {
      if (!best || dir.length < best.dir.length) {
        best = { dir, conventions: entry.conventions };
      }
    }
  }
  return best?.conventions;
}

// ---------------------------------------------------------------------------
// State accessors / mutators
// ---------------------------------------------------------------------------

/** Returns `true` when scoping is active (vault path was set and valid). */
export function isScopingEnabled(): boolean {
  return enabled;
}

/** Returns the currently active scope name. */
export function getActiveScope(): string {
  return activeScope;
}

/** Returns the home (startup) scope name. */
export function getHomeScope(): string {
  return homeScope;
}

/**
 * Changes the active scope for the current session.
 * Does not validate against `discoverScopes()` — callers must validate.
 *
 * Note: this is module-level state shared across all MCP client connections
 * on this server process. A scope change affects all active sessions.
 */
export function setActiveScope(scope: string): void {
  activeScope = scope;
}

/** Resets the active scope to the configured home scope. */
export function resetToHomeScope(): void {
  activeScope = homeScope;
}

/** Returns `true` when the LLM-facing `vault_scope_set` tool is enabled. */
export function isScopeSwitchingEnabled(): boolean {
  return scopeSwitchingEnabled;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialises the scope engine from the given vault path.
 *
 * Reads every `.vaultgate` file under `vaultPath` synchronously, builds the
 * `ScopeMap`, and sets module-level state. On success, `isScopingEnabled()`
 * returns `true` and all scope functions become active.
 *
 * Noop-safe: if `vaultPath` does not exist or is not a directory, the engine
 * stays disabled and a warning is logged (no exception thrown).
 *
 * @param vaultPath      Absolute path to the vault root on the filesystem.
 * @param initialScope   Home scope name (from `OBSIDIAN_SCOPE` / tray config).
 * @param switching      Whether the `vault_scope_set` tool should be registered.
 */
export function initScopeEngine(vaultPath: string, initialScope: string, switching: boolean): void {
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    console.error(
      `[VaultGate] OBSIDIAN_VAULT_PATH "${vaultPath}" does not exist or is not a directory — vault scoping disabled.`
    );
    return;
  }
  vaultRootPath = vaultPath;
  homeScope = initialScope || "unscoped";
  activeScope = homeScope;
  scopeSwitchingEnabled = switching;
  scopeMap = buildScopeMap(vaultPath);
  enabled = true;
  console.error(
    `[VaultGate] Vault scoping enabled. Home scope: "${homeScope}". Discovered scopes: ${discoverScopes().join(", ")}.`
  );
}

/**
 * Re-scans the vault filesystem and atomically replaces the ScopeMap.
 * Called when `.vaultgate` files may have changed (vault path IPC update,
 * or manual "Refresh scope map" tray action).
 *
 * Noop when scoping is disabled.
 */
export function rebuildScopeMap(): void {
  if (!enabled || !vaultRootPath) return;
  scopeMap = buildScopeMap(vaultRootPath);
  console.error(
    `[VaultGate] Scope map rebuilt. Discovered scopes: ${discoverScopes().join(", ")}.`
  );
}

/**
 * Updates the vault path and rebuilds the scope map.
 * Called by the tray IPC handler when the user changes the vault in Preferences.
 * Also resets the active scope to the home scope.
 *
 * @param newVaultPath  New absolute filesystem path to the vault root.
 */
export function updateVaultPath(newVaultPath: string | undefined): void {
  if (!newVaultPath) {
    enabled = false;
    vaultRootPath = undefined;
    return;
  }
  if (!fs.existsSync(newVaultPath) || !fs.statSync(newVaultPath).isDirectory()) {
    console.error(
      `[VaultGate] updateVaultPath: "${newVaultPath}" does not exist or is not a directory — keeping existing scope state.`
    );
    return;
  }
  vaultRootPath = newVaultPath;
  scopeMap = buildScopeMap(newVaultPath);
  resetToHomeScope();
  console.error(
    `[VaultGate] Vault path updated. Scope map rebuilt. Discovered scopes: ${discoverScopes().join(", ")}.`
  );
}
