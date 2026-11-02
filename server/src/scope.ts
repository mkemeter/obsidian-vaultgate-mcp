import { AsyncLocalStorage } from "node:async_hooks";
import { runObsidianAdmin } from "./cli.js";
import { config } from "./config.js";

/**
 * Vault scopes — server-enforced partitioning of an Obsidian vault into named
 * zones. Notes outside the active scope are invisible to all tools.
 *
 * Configuration: add a `scope:` key to the YAML frontmatter of the vault
 * conventions file (e.g. `VAULTGATE.md`) in any subdirectory to declare a
 * scope zone for notes in that directory and below. Optionally add `access:`
 * and `isolation:` to control what AI operations are permitted:
 *
 * `access:` (default `full`):
 * - `full` — full read/write access
 * - `read` — read-only; write operations are blocked
 * - `none` — fully excluded; all access is blocked regardless of isolation
 *
 * `isolation:` (default `strict`):
 * - `strict` — zone is only visible when it is the active scope
 * - `shared` — zone is visible from any active scope; `access:` still enforced
 *
 * VaultGate discovers all scope zones automatically at startup by listing vault
 * files via the CLI — no filesystem access is ever performed.
 *
 * Root conventions file behaviour:
 * - WITHOUT `scope:` frontmatter → always injected as the global baseline.
 *   When the active scope is a named scope, that scope's conventions file is
 *   appended on top of the root.
 * - WITH `scope:` frontmatter → the root file is a named scope zone itself.
 *   It is only injected when the active scope matches; not globally.
 *
 * Core invariant: notes from different scopes never appear in the same tool
 * result unless the note's scope has `isolation: shared`. Enforced here in
 * server code, not by LLM instructions.
 *
 * CLI-only invariant: all vault access goes exclusively through runObsidian().
 * Direct filesystem reads/writes on vault content are forbidden in this module.
 * Internal discovery calls use runObsidianAdmin() to bypass the access guard.
 */

/** Maximum length (characters) for a scope name. Longer values are discarded. */
const MAX_SCOPE_NAME_LENGTH = 64;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Permitted access level for a scope zone. */
export type ScopeAccess = "full" | "read" | "none";

/** Isolation level for a scope zone. */
export type ScopeIsolation = "strict" | "shared";

/** Discriminated union returned by {@link checkAccess}. */
export type AccessResult = { allowed: true } | { allowed: false; message: string };

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Maps vault-relative directory path → scope name declared there. */
let scopeZoneMap: Map<string, string> = new Map();
/** Maps scope name → vault-relative path of the conventions file that declares it. */
let conventionsPathMap: Map<string, string> = new Map();
/** Maps scope name → declared access level (`"full"` when absent). */
let scopeAccessMap: Map<string, ScopeAccess> = new Map();
/** Maps scope name → declared isolation level (`"strict"` when absent). */
let scopeIsolationMap: Map<string, ScopeIsolation> = new Map();
/** True when the vault root conventions file itself carries a `scope:` key. */
let rootHasScope = false;
let homeScope = "unscoped";
let _defaultScope = "unscoped"; // active scope for stdio mode / no-session context
const _sessionStorage = new AsyncLocalStorage<string>();
const _activeScopeBySession = new Map<string, string>();
let scopeSwitchingEnabled = false;
let enabled = false;

// ---------------------------------------------------------------------------
// Error messages
// ---------------------------------------------------------------------------

/** Standard error message returned when a note path is blocked by scope enforcement. */
export const SCOPE_BLOCKED_MESSAGE = "This note is not accessible in the current scope.";

/** Error message returned when a write operation is blocked by a read-only scope. */
export const SCOPE_WRITE_BLOCKED_MESSAGE =
  "This scope is read-only — write operations are not permitted.";

/** Error message returned when any access is blocked by a no-access scope. */
export const SCOPE_NO_ACCESS_MESSAGE = "This scope has no AI access — all operations are blocked.";

/** Error message returned when a note is outside the active scope. */
export const SCOPE_OUT_OF_SCOPE_MESSAGE = "This note is outside the active scope.";

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

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the body of a Markdown file, stripping YAML frontmatter if present.
 * Used before injecting conventions so the AI sees only prose, not config metadata.
 */
export function extractBody(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return match ? content.slice(match[0].length) : content;
}

/**
 * Parses the `scope:` value from YAML frontmatter, returning it as a string or
 * `undefined` when absent, malformed, or exceeding {@link MAX_SCOPE_NAME_LENGTH}.
 */
function parseScopeFrontmatter(content: string): string | undefined {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch?.[1]) return undefined;
  const fm = frontmatterMatch[1];
  const scopeMatch = /^scope:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm);
  if (!scopeMatch?.[1]) return undefined;
  const raw = scopeMatch[1].trim();
  if (!raw || raw.length > MAX_SCOPE_NAME_LENGTH) return undefined;
  return raw;
}

/**
 * Parses the `access:` value from YAML frontmatter.
 * Absent, blank, or unrecognised → `"full"`.
 */
function parseAccessLevel(content: string): ScopeAccess {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch?.[1]) return "full";
  const fm = frontmatterMatch[1];
  const accessMatch = /^access:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm);
  if (!accessMatch?.[1]) return "full";
  switch (accessMatch[1].trim().toLowerCase()) {
    case "none":
      return "none";
    case "read":
      return "read";
    case "full":
      return "full";
    default:
      return "full";
  }
}

/**
 * Parses the `isolation:` value from YAML frontmatter.
 * Absent, blank, or unrecognised → `"strict"`.
 */
function parseIsolationLevel(content: string): ScopeIsolation {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch?.[1]) return "strict";
  const fm = frontmatterMatch[1];
  const isolationMatch = /^isolation:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm);
  if (!isolationMatch?.[1]) return "strict";
  switch (isolationMatch[1].trim().toLowerCase()) {
    case "shared":
      return "shared";
    default:
      return "strict";
  }
}

// ---------------------------------------------------------------------------
// CLI-based scope map builder
// ---------------------------------------------------------------------------

/**
 * Discovers scope zones by listing vault files via the CLI, reading each
 * conventions file, and parsing YAML frontmatter for `scope:` and `access:`
 * declarations.
 *
 * Uses `runObsidianAdmin` (bypasses the access guard) so discovery always
 * succeeds even when scope zones have `access: none`.
 *
 * Only files whose basename matches `config.contextFileName` are examined.
 * Atomically replaces module state on success; throws on CLI failure so the
 * caller can decide whether to disable scoping or keep the existing state.
 */
async function buildScopeMapFromCli(): Promise<void> {
  const contextFileName = config.contextFileName;

  let fileList: string;
  try {
    fileList = await runObsidianAdmin(["files", "list"]);
  } catch (err) {
    throw new Error(`Failed to list vault files: ${err}`);
  }

  const allFiles = fileList
    .split("\n")
    .map((s) => normalizePath(s.trim()))
    .filter(Boolean);

  const conventionsFiles = allFiles.filter((p) => {
    const base = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p;
    return base === contextFileName;
  });

  const newZoneMap: Map<string, string> = new Map();
  const newAccessMap: Map<string, ScopeAccess> = new Map();
  const newIsolationMap: Map<string, ScopeIsolation> = new Map();
  // Tracks the shortest-path file per scope name for the conventionsPathMap.
  const scopeShortestDir = new Map<string, { dir: string; filePath: string }>();
  let newRootHasScope = false;

  for (const filePath of conventionsFiles) {
    let content: string;
    try {
      content = await runObsidianAdmin(["read", `path=${filePath}`]);
    } catch {
      continue;
    }

    const scope = parseScopeFrontmatter(content);
    if (!scope) continue;

    const dirRaw = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const dir = normalizePath(dirRaw);
    newZoneMap.set(dir, scope);

    const access = parseAccessLevel(content);
    newAccessMap.set(scope, access);

    const isolation = parseIsolationLevel(content);
    newIsolationMap.set(scope, isolation);

    const existing = scopeShortestDir.get(scope);
    if (!existing || dir.length < existing.dir.length) {
      scopeShortestDir.set(scope, { dir, filePath });
    }

    if (dir === "") {
      newRootHasScope = true;
    }
  }

  const newConventionsMap: Map<string, string> = new Map();
  for (const [scope, { filePath }] of scopeShortestDir) {
    newConventionsMap.set(scope, filePath);
  }

  // Atomic replacement — only reaches here if files:list succeeded.
  scopeZoneMap = newZoneMap;
  conventionsPathMap = newConventionsMap;
  scopeAccessMap = newAccessMap;
  scopeIsolationMap = newIsolationMap;
  rootHasScope = newRootHasScope;
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Returns the declared access level for a scope, defaulting to `"full"` when
 * the scope has no `access:` declaration. Backward-compatible: vaults without
 * `access:` frontmatter behave identically to before.
 */
export function getScopeAccess(scope: string): ScopeAccess {
  return scopeAccessMap.get(scope) ?? "full";
}

/**
 * Returns the declared isolation level for a scope, defaulting to `"strict"`
 * when the scope has no `isolation:` declaration. Backward-compatible: existing
 * scopes without `isolation:` frontmatter behave identically to before.
 */
export function getScopeIsolation(scope: string): ScopeIsolation {
  return scopeIsolationMap.get(scope) ?? "strict";
}

/**
 * Returns the access level of the currently active scope.
 * Defaults to `"full"` when no `access:` declaration exists for the active scope.
 */
export function getActiveScopeAccess(): ScopeAccess {
  return getScopeAccess(getActiveScope());
}

/**
 * Central access-policy decision point. All current and future access rules
 * live here — callers only need to check the returned {@link AccessResult}.
 *
 * When scoping is not configured (`scopeZoneMap` empty, `activeScope = "unscoped"`),
 * every path resolves to `"unscoped"` with default `"full"` access and passes all
 * checks — no explicit enabled-guard needed.
 *
 * Rules applied (in order):
 * 1. Conventions files are always **readable** regardless of scope or access
 *    level (the AI must be able to read VaultGate config). Write restrictions
 *    still apply; scope membership still applies to writes.
 * 2. Scope-level `access: none` → all operations denied (absolute).
 * 3. Scope membership: notes from a different scope are denied unless the note's
 *    scope has `isolation: shared`. Direct path knowledge does not grant access.
 * 4. Scope-level `access: read` + write operation → denied.
 *
 * Future note-level access rules slot in after step 4.
 */
export function checkAccess(path: string | undefined, op: "read" | "write"): AccessResult {
  // Conventions files are always readable — VaultGate config, not notes.
  // Applies across scope boundaries (root conventions file is injected in all
  // named scopes when rootHasScope = false). Write restrictions still apply.
  if (op === "read" && path !== undefined) {
    const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
    if (base === config.contextFileName) return { allowed: true };
  }

  const current = getActiveScope();
  const noteScope = path !== undefined ? resolveNoteScope(path) : current;
  const access = getScopeAccess(noteScope);

  // `none` is absolute.
  if (access === "none") return { allowed: false, message: SCOPE_NO_ACCESS_MESSAGE };

  // Scope membership: knowing a path does not grant access to another scope.
  // Shared-isolation scopes skip this check — their notes are visible from any
  // active scope. `access: none` (step 2) always fires first and cannot be bypassed.
  if (path !== undefined && noteScope !== current && getScopeIsolation(noteScope) === "strict") {
    return { allowed: false, message: SCOPE_OUT_OF_SCOPE_MESSAGE };
  }

  if (access === "read" && op === "write")
    return { allowed: false, message: SCOPE_WRITE_BLOCKED_MESSAGE };

  // Future: note-level access rules slot in here
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the scope for a vault-relative note path by walking up the
 * directory chain and returning the scope from the nearest ancestor
 * conventions file. Returns `"unscoped"` when no ancestor declares a scope.
 */
export function resolveNoteScope(notePath: string): string {
  if (!enabled) return "unscoped";
  const normalized = normalizePath(notePath);
  let dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  while (true) {
    const scope = scopeZoneMap.get(dir);
    if (scope) return scope;
    if (dir === "") break;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
  return "unscoped";
}

/**
 * Returns `true` when the note is accessible in the current session state.
 * Delegates entirely to {@link checkAccess} — access level and scope membership
 * are both enforced there, keeping the two in sync automatically.
 */
export function isNoteInScope(notePath: string): boolean {
  return checkAccess(notePath, "read").allowed;
}

/**
 * Returns `true` when the given note path must be blocked from all AI-visible
 * operations — when the note's scope does not match the active scope, or the
 * note's scope has `access: none`.
 *
 * Passing `undefined` (the active Obsidian file — unknown to VaultGate) always
 * returns `false`, allowing the call to proceed.
 */
export function isPathBlocked(notePath: string | undefined): boolean {
  if (notePath === undefined) return false;
  return !isNoteInScope(notePath);
}

/**
 * Filters an array of vault-relative paths to those accessible in the active scope.
 */
export function filterByScope(paths: string[]): string[] {
  return paths.filter((p) => isNoteInScope(p));
}

/**
 * Returns all unique scope names discovered across all conventions files, plus
 * the always-present `"unscoped"` zone. The list is sorted alphabetically.
 */
export function discoverScopes(): string[] {
  const scopes = new Set<string>(["unscoped"]);
  for (const scope of conventionsPathMap.keys()) {
    scopes.add(scope);
  }
  return [...scopes].sort();
}

/**
 * Returns the ordered list of vault-relative conventions file paths to read
 * and inject for the current session state.
 *
 * Logic:
 * - Scoping disabled → `[config.contextFileName]` (root file only)
 * - Root has no `scope:` frontmatter (global baseline):
 *   - Unscoped or unnamed scope → `[root]`
 *   - Named scope with a conventions file → `[root, scopeFile]`
 * - Root has `scope:` frontmatter (root is itself a scope zone):
 *   - Active scope has a conventions file → `[scopeFile]`
 *   - Otherwise → `[]` (no conventions injected)
 */
export function getConventionsPaths(): string[] {
  if (!enabled) {
    return [config.contextFileName];
  }
  const scope = getActiveScope();
  if (!rootHasScope) {
    const paths: string[] = [config.contextFileName];
    if (scope !== "unscoped") {
      const scopePath = conventionsPathMap.get(scope);
      if (scopePath) paths.push(scopePath);
    }
    return paths;
  }
  // Root carries a scope: — only inject it when the active scope matches.
  const scopePath = conventionsPathMap.get(scope);
  return scopePath ? [scopePath] : [];
}

/**
 * Returns `true` when the root conventions file does NOT carry a `scope:`
 * frontmatter key, meaning it acts as a global baseline injected for all scopes.
 */
export function isRootGlobal(): boolean {
  return !rootHasScope;
}

// ---------------------------------------------------------------------------
// State accessors / mutators
// ---------------------------------------------------------------------------

/** Returns `true` when scoping is active (scope zones were discovered). */
export function isScopingEnabled(): boolean {
  return enabled;
}

/** Returns the currently active scope for the current session context. */
export function getActiveScope(): string {
  const sid = _sessionStorage.getStore();
  if (!sid) return _defaultScope;
  return _activeScopeBySession.get(sid) ?? homeScope;
}

/** Returns the home (startup) scope name. */
export function getHomeScope(): string {
  return homeScope;
}

/** Called when an HTTP session opens. Initialises the session to homeScope. */
export function registerSession(sessionId: string): void {
  _activeScopeBySession.set(sessionId, homeScope);
}

/** Called when an HTTP session closes. Prevents Map growth. */
export function unregisterSession(sessionId: string): void {
  _activeScopeBySession.delete(sessionId);
}

/** Runs fn inside the given session's async context. */
export function runWithSession<T>(sessionId: string, fn: () => T): T {
  return _sessionStorage.run(sessionId, fn);
}

/**
 * Changes the active scope for the current session.
 * Does not validate against `discoverScopes()` — callers must validate.
 */
export function setActiveScope(scope: string): void {
  const sid = _sessionStorage.getStore();
  if (!sid) {
    // stdio mode or tray IPC: update the no-session default and all registered sessions
    _defaultScope = scope;
    for (const id of _activeScopeBySession.keys()) {
      _activeScopeBySession.set(id, scope);
    }
    return;
  }
  _activeScopeBySession.set(sid, scope);
}

/** Resets all sessions to the configured home scope. */
export function resetToHomeScope(): void {
  _defaultScope = homeScope;
  for (const id of _activeScopeBySession.keys()) {
    _activeScopeBySession.set(id, homeScope);
  }
}

/** Returns `true` when the LLM-facing `vault_scope_set` tool is enabled. */
export function isScopeSwitchingEnabled(): boolean {
  return scopeSwitchingEnabled;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialises the scope engine by discovering scope zones via the Obsidian CLI.
 *
 * Scoping is enabled only when at least one conventions file with a `scope:`
 * frontmatter key is found. Vaults without any scope declarations behave exactly
 * as before — no filtering, no tool registration.
 *
 * Safe to call unconditionally at server startup; the engine self-enables only
 * when scope zones are found. On CLI failure, scoping stays disabled.
 *
 * @param initialScope  Home scope name (from `OBSIDIAN_SCOPE` env / tray config).
 * @param switching     Whether the `vault_scope_set` tool should be registered.
 */
export async function initScopeEngine(initialScope: string, switching: boolean): Promise<void> {
  homeScope = initialScope || "unscoped";
  _defaultScope = homeScope;
  scopeSwitchingEnabled = switching;

  try {
    await buildScopeMapFromCli();
  } catch (err) {
    console.error(
      `[VaultGate] scope.ts: Failed to build scope map: ${err} — vault scoping disabled.`
    );
    return;
  }

  if (scopeZoneMap.size === 0) {
    return;
  }

  enabled = true;

  if (getScopeAccess(homeScope) === "none") {
    console.error(
      `[VaultGate] Warning: home scope "${homeScope}" has access: none — all tool calls will be blocked until scope is switched.`
    );
  }

  console.error(
    `[VaultGate] Vault scoping enabled. Home scope: "${homeScope}". Discovered scopes: ${discoverScopes().join(", ")}.`
  );
}

/**
 * Re-scans the vault and atomically replaces the scope map.
 * Called when conventions files may have changed (vault switch, manual tray refresh).
 * No-op when scoping is disabled.
 */
export async function rebuildScopeMap(): Promise<void> {
  if (!enabled) return;
  try {
    await buildScopeMapFromCli();
    console.error(
      `[VaultGate] Scope map rebuilt. Discovered scopes: ${discoverScopes().join(", ")}.`
    );
  } catch (err) {
    console.error(`[VaultGate] scope.ts: Scope map rebuild failed: ${err}`);
  }
}
