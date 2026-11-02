import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Access guard — installed from server.ts after scope engine initialises
// ---------------------------------------------------------------------------

/** Async-ready callback type for the access guard. */
type AccessGuard = (args: string[]) => Promise<void> | void;

let _accessGuard: AccessGuard | undefined;

/**
 * Installs the access guard callback. Called once from `createServer()` after
 * `initScopeEngine()` completes. The guard fires at the start of every
 * `runObsidian()` call (but NOT `runObsidianAdmin()`).
 */
export function installAccessGuard(fn: AccessGuard): void {
  _accessGuard = fn;
}

// ---------------------------------------------------------------------------
// Write-command classification and path extraction
// ---------------------------------------------------------------------------

/**
 * CLI commands that mutate vault state. Used by the access guard to distinguish
 * read operations from write operations for `read`-access scope enforcement.
 */
export const CLI_WRITE_COMMANDS: ReadonlySet<string> = new Set([
  "create",
  "append",
  "prepend",
  "delete",
  "daily:append",
  "property:set",
  "eval",
  "plugin:reload",
  "dev:screenshot",
  "dev:mobile",
]);

/**
 * Returns `true` when the CLI args represent a write (mutating) operation.
 * Covers both the simple `command` form and the `["templates", "apply", ...]`
 * compound form.
 */
export function isCliWriteCommand(args: string[]): boolean {
  if (args[0] === "templates" && args[1] === "apply") return true;
  return CLI_WRITE_COMMANDS.has(args[0] ?? "");
}

/**
 * Extracts the vault-relative note path from CLI args, if present.
 * Returns `undefined` for list/discovery operations that carry no path.
 */
export function extractNotePath(args: string[]): string | undefined {
  const pathArg = args.find((a) => a.startsWith("path="));
  if (pathArg !== undefined) return pathArg.slice(5);
  const nameArg = args.find((a) => a.startsWith("name="));
  if (nameArg !== undefined) return nameArg.slice(5);
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal implementation (shared by runObsidian and runObsidianAdmin)
// ---------------------------------------------------------------------------

async function runObsidianRaw(args: string[]): Promise<string> {
  // Prepend vault targeting if configured. Must be the first argument
  // per the Obsidian CLI spec: `obsidian vault="My Vault" <command> ...`
  const fullArgs = config.vault ? [`vault=${config.vault}`, ...args] : [...args];

  try {
    const { stdout } = await execFileAsync(config.cliBin, fullArgs, {
      // 30-second timeout to avoid hanging if Obsidian stops responding
      timeout: 30_000,
      // Enough buffer for large vault listings or long note contents
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    // execFile throws an object with stderr when the process exits non-zero,
    // and sets `killed`/`signal` when it terminates the child (timeout or
    // maxBuffer overflow).
    const err = error as NodeJS.ErrnoException & {
      stderr?: string;
      killed?: boolean;
    };

    if (err.code === "ENOENT") {
      throw new Error(
        `Obsidian CLI binary not found: "${config.cliBin}"\n` +
          `  Set OBSIDIAN_CLI_PATH to the absolute path of the obsidian binary, or\n` +
          `  enable the CLI in Obsidian: Settings → General → Register CLI`
      );
    }

    // maxBuffer overflow ALSO kills the child (killed=true), so this must be
    // checked BEFORE the timeout branch or a large listing would be misreported
    // as an unresponsive-Obsidian timeout.
    if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new Error(
        `Obsidian CLI output exceeded the 10 MB buffer limit.\n` +
          `  Narrow the request (e.g. add a limit= argument) and try again.`
      );
    }

    // A 30s timeout kills the child; execFile reports this via `killed`, NOT via
    // a code of "ETIMEDOUT". Having ruled out maxBuffer above, a killed child
    // here means the timeout fired. Point at the real cause (a frozen or slow
    // Obsidian) instead of the generic "Register CLI" hint.
    if (err.killed) {
      throw new Error(
        `Obsidian CLI timed out after 30s — Obsidian may be unresponsive.\n` +
          `  Check that Obsidian is running and responsive, then try again.`
      );
    }

    // The binary ran but exited non-zero. The most common runtime cause is that
    // the CLI has not been registered in Obsidian (or the vault is unavailable),
    // and Obsidian's own stderr for this is undocumented and often opaque. Keep
    // whatever Obsidian reported and append an actionable hint so the user is
    // pointed at the fix rather than left with a bare passthrough.
    const detail = err.stderr?.trim() || err.message;
    throw new Error(
      `Obsidian CLI error: ${detail}\n` +
        `  If this persists, check that the CLI is registered and Obsidian is\n` +
        `  running: Settings → General → Command line interface → Register CLI.`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes an Obsidian CLI command and returns its stdout.
 *
 * Runs the access guard (if installed) before executing. The guard may throw
 * to block the operation — callers must handle the error.
 *
 * Uses `execFile` (not `exec`) to prevent shell injection — args are passed
 * as an array and are never interpolated into a shell string. This means
 * special characters in note names, content, or vault names are safe.
 *
 * If `config.vault` is set, prepends `vault="<name>"` as the first argument,
 * targeting that specific vault as documented in the Obsidian CLI spec.
 *
 * @param args  CLI arguments excluding the binary name.
 *              Example: `["search", "query=hello world", "limit=10"]`
 * @returns     Trimmed stdout string from the CLI process.
 * @throws      Error whose message contains the stderr output if the
 *              process exits with a non-zero code, or if the binary
 *              cannot be found.
 */
export async function runObsidian(args: string[]): Promise<string> {
  if (_accessGuard !== undefined) await _accessGuard(args);
  return runObsidianRaw(args);
}

/**
 * Executes an Obsidian CLI command without running the access guard.
 *
 * **Infrastructure-only — never use from `tools/`; bypasses the access guard.**
 *
 * Used exclusively by `scope.ts` for vault discovery operations
 * (`buildScopeMapFromCli`) that must run regardless of scope access levels.
 * All user-facing tool calls must go through `runObsidian`.
 */
export async function runObsidianAdmin(args: string[]): Promise<string> {
  return runObsidianRaw(args);
}
