import { runObsidian } from "./cli.js";
import { config } from "./config.js";

/**
 * Vault scopes — server-enforced partitioning of an Obsidian vault into named
 * zones. Notes outside the active scope are invisible to all tools.
 *
 * Configuration: add a `scope:` key to the YAML frontmatter of the vault
 * conventions file (e.g. `VAULTGATE.md`) in any subdirectory to declare a
 * scope zone for notes in that directory and below. VaultGate discovers all
 * scope zones automatically at startup by listing vault files via the CLI —
 * no filesystem access is ever performed.
 *
 * Root conventions file behaviour:
 * - WITHOUT `scope:` frontmatter → always injected as the global baseline.
 *   When the active scope is a named scope, that scope's conventions file is
 *   appended on top of the root.
 * - WITH `scope:` frontmatter → the root file is a named scope zone itself.
 *   It is only injected when the active scope matches; not globally.
 *
 * Core invariant: notes from different scopes never appear in the same tool
 * result. Enforced here in server code, not by LLM instructions.
 *
 * CLI-only invariant: all vault access goes exclusively through runObsidian().
 * Direct filesystem reads/writes on vault content are forbidden in this module.
 */

/** Maximum length (characters) for a scope name. Longer values are discarded. */
const MAX_SCOPE_NAME_LENGTH = 64;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Maps vault-relative directory path → scope name declared there. */
let scopeZoneMap: Map<string, string> = new Map();
/** Maps scope name → vault-relative path of the conventions file that declares it. */
let conventionsPathMap: Map<string, string> = new Map();
/** True when the vault root conventions file itself carries a `scope:` key. */
let rootHasScope = false;
let homeScope = "unscoped";
let activeScope = "unscoped";
let scopeSwitchingEnabled = false;
let enabled = false;

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

// ---------------------------------------------------------------------------
// CLI-based scope map builder
// ---------------------------------------------------------------------------

/**
 * Discovers scope zones by listing vault files via the CLI, reading each
 * conventions file, and parsing YAML frontmatter for `scope:` declarations.
 *
 * Only files whose basename matches `config.contextFileName` are examined.
 * Atomically replaces module state on success; throws on CLI failure so the
 * caller can decide whether to disable scoping or keep the existing state.
 */
async function buildScopeMapFromCli(): Promise<void> {
  const contextFileName = config.contextFileName;

  let fileList: string;
  try {
    fileList = await runObsidian(["files:list"]);
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
  // Tracks the shortest-path file per scope name for the conventionsPathMap.
  const scopeShortestDir = new Map<string, { dir: string; filePath: string }>();
  let newRootHasScope = false;

  for (const filePath of conventionsFiles) {
    let content: string;
    try {
      content = await runObsidian(["read", `path=${filePath}`]);
    } catch {
      continue;
    }

    const scope = parseScopeFrontmatter(content);
    if (!scope) continue;

    const dirRaw = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const dir = normalizePath(dirRaw);
    newZoneMap.set(dir, scope);

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
  rootHasScope = newRootHasScope;
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
 * Returns `true` when the note belongs to the currently active scope.
 * Always returns `true` when scoping is disabled or the active scope is
 * `"unscoped"` (which grants full vault access).
 */
export function isNoteInScope(notePath: string): boolean {
  if (!enabled || activeScope === "unscoped") return true;
  return resolveNoteScope(notePath) === activeScope;
}

/** Standard error message returned when a note path is blocked by scope enforcement. */
export const SCOPE_BLOCKED_MESSAGE = "This note is not accessible in the current scope.";

/**
 * Returns `true` when the given note path must be blocked from all AI-visible
 * operations: when scoping is enabled and the note's scope does not match the
 * active scope. Notes are always accessible in the `"unscoped"` state.
 *
 * Passing `undefined` (the active Obsidian file — unknown to VaultGate) always
 * returns `false`, allowing the call to proceed.
 */
export function isPathBlocked(notePath: string | undefined): boolean {
  if (notePath === undefined) return false;
  return !isNoteInScope(notePath);
}

/**
 * Filters an array of vault-relative paths to those belonging to the active scope.
 * Returns the full array unchanged when scoping is disabled or the active scope is
 * `"unscoped"` (full vault access).
 */
export function filterByScope(paths: string[]): string[] {
  if (!enabled || activeScope === "unscoped") return paths;
  return paths.filter((p) => resolveNoteScope(p) === activeScope);
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
  if (!rootHasScope) {
    const paths: string[] = [config.contextFileName];
    if (activeScope !== "unscoped") {
      const scopePath = conventionsPathMap.get(activeScope);
      if (scopePath) paths.push(scopePath);
    }
    return paths;
  }
  // Root carries a scope: — only inject it when the active scope matches.
  const scopePath = conventionsPathMap.get(activeScope);
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
  activeScope = homeScope;
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
