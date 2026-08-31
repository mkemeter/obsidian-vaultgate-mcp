/**
 * Configuration loaded from environment variables.
 *
 * All values are optional — sensible defaults are applied so the server
 * works out of the box without any configuration. Users set these in their
 * assistant's MCP config or in a local `.env` file.
 */
export interface Config {
  /**
   * Target vault name. When set, every CLI command is prefixed with
   * `vault="<name>"` so it targets this specific vault rather than the
   * most-recently focused one.
   *
   * Leave unset if you only have one vault.
   */
  vault: string | undefined;

  /**
   * Absolute path (or bare name) of the `obsidian` CLI binary.
   *
   * Defaults to `"obsidian"`, which works when the CLI has been registered
   * via Obsidian's Settings → General → Register CLI.
   *
   * Set this to an absolute path (e.g.
   * `/Applications/Obsidian.app/Contents/MacOS/obsidian`) when running
   * under launchd or other environments where PATH is not inherited from
   * the user's shell.
   */
  cliBin: string;

  /**
   * TCP port the HTTP server listens on. Defaults to `3001`.
   *
   * The server always binds to `127.0.0.1` (localhost only) regardless
   * of this setting — it is never exposed to the network.
   */
  port: number;

  /**
   * Bind address. Always `127.0.0.1` — not configurable.
   * Kept as a named constant to make intent explicit in server code.
   */
  readonly host: "127.0.0.1";

  /**
   * Filename of the vault conventions file read at session start and via
   * `vault_context` / written by `vault_context_set`. Always resolved
   * relative to the vault root — only the name is configurable, never a path.
   *
   * Defaults to `"VAULTGATE.md"`. Set `OBSIDIAN_CONTEXT_FILE` to reuse an
   * existing file such as `CLAUDE.md` instead of maintaining a separate one.
   */
  contextFileName: string;

  /**
   * Whether the server automatically injects vault conventions into tool
   * results. When enabled, conventions are merged into the first tool result
   * of each new conversation (determined by `injectIntervalSecs`).
   *
   * Defaults to `true`. Set `VAULTGATE_INJECT_CONVENTIONS=false` to disable.
   * Configurable at runtime via the tray Preferences dialog.
   */
  injectConventions: boolean;

  /**
   * How often (in seconds) vault conventions are re-injected into tool results.
   * Acts as a conversation boundary detector: tool calls within a single
   * thread happen seconds apart, so conventions are delivered exactly once at
   * the start of each new conversation.
   *
   * Defaults to `30`. Set `VAULTGATE_INJECT_INTERVAL` to an integer ≥ 1.
   * Configurable at runtime via the tray Preferences dialog.
   */
  injectIntervalSecs: number;
}

/** Default conventions filename when `OBSIDIAN_CONTEXT_FILE` is unset. */
const DEFAULT_CONTEXT_FILE = "VAULTGATE.md";

/** Default injection interval in seconds. */
const DEFAULT_INJECT_INTERVAL = 30;

/** Lower bound (inclusive) for the injection interval, in seconds. */
const MIN_INJECT_INTERVAL = 1;

/** Upper bound (inclusive) for the injection interval, in seconds (1 hour). */
const MAX_INJECT_INTERVAL = 3600;

/**
 * Returns `true` if `n` is a valid injection interval: an integer between
 * {@link MIN_INJECT_INTERVAL} and {@link MAX_INJECT_INTERVAL} inclusive.
 */
function isValidInterval(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_INJECT_INTERVAL && n <= MAX_INJECT_INTERVAL;
}

/**
 * Coerces and validates an injection-interval value from any source, returning
 * a safe integer. Accepts numbers and numeric strings (the IPC boundary may
 * deliver either); any invalid input — NaN, out-of-range, non-integer, or a
 * non-numeric string — falls back to {@link DEFAULT_INJECT_INTERVAL}.
 *
 * This is the single validation gate shared by every entry point that sets the
 * interval (env parsing and the runtime IPC setter), so an invalid value can
 * never reach `config.injectIntervalSecs` and disable the injection TTL guard.
 *
 * @param value  Raw interval from env, IPC, or a caller.
 * @returns      A valid integer interval in seconds.
 */
export function sanitizeInterval(value: unknown): number {
  const n =
    typeof value === "string"
      ? parseInt(value, 10)
      : typeof value === "number"
        ? value
        : Number.NaN;
  return isValidInterval(n) ? n : DEFAULT_INJECT_INTERVAL;
}

/**
 * Normalises and validates the configured conventions filename.
 *
 * The file must live in the vault root, so only a bare filename is accepted:
 * path separators (`/`, `\`) and `..` segments are rejected, and the name must
 * end in `.md`. An empty or unset value falls back to the default.
 *
 * @param raw  Raw `OBSIDIAN_CONTEXT_FILE` value (already trimmed), or undefined.
 * @returns    A validated bare `.md` filename.
 * @throws     Error when the value contains a path separator, a `..` segment,
 *             or does not end in `.md`.
 */
export function normalizeContextFileName(raw: string | undefined): string {
  if (!raw) return DEFAULT_CONTEXT_FILE;

  if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
    throw new Error(
      `Invalid OBSIDIAN_CONTEXT_FILE value "${raw}" — must be a bare filename ` +
        `in the vault root (no path separators or "..").`
    );
  }

  if (!raw.toLowerCase().endsWith(".md")) {
    throw new Error(
      `Invalid OBSIDIAN_CONTEXT_FILE value "${raw}" — must be a Markdown file ending in ".md".`
    );
  }

  return raw;
}

/**
 * Loads configuration from environment variables with safe defaults.
 *
 * No personal details (vault names, paths) are hardcoded here.
 * Everything is supplied at runtime by the user's environment.
 */
export function loadConfig(): Config {
  const rawPort = process.env.OBSIDIAN_MCP_PORT;
  const port = rawPort !== undefined ? parseInt(rawPort, 10) : 3001;

  if (rawPort !== undefined && (Number.isNaN(port) || port < 1 || port > 65535)) {
    throw new Error(
      `Invalid OBSIDIAN_MCP_PORT value "${rawPort}" — must be an integer between 1 and 65535.`
    );
  }

  const rawVault = process.env.OBSIDIAN_VAULT?.trim();

  const injectConventions = process.env.VAULTGATE_INJECT_CONVENTIONS?.trim() !== "false";

  const rawInterval = process.env.VAULTGATE_INJECT_INTERVAL?.trim();
  let injectIntervalSecs = DEFAULT_INJECT_INTERVAL;
  if (rawInterval !== undefined) {
    const parsed = parseInt(rawInterval, 10);
    if (isValidInterval(parsed)) {
      injectIntervalSecs = parsed;
    } else {
      console.error(
        `[VaultGate] Invalid VAULTGATE_INJECT_INTERVAL value "${rawInterval}" — must be an integer between ${MIN_INJECT_INTERVAL} and ${MAX_INJECT_INTERVAL}. Using default (${DEFAULT_INJECT_INTERVAL}s).`
      );
    }
  }

  return {
    vault: rawVault || undefined,
    cliBin: process.env.OBSIDIAN_CLI_PATH || "obsidian",
    port,
    host: "127.0.0.1",
    contextFileName: normalizeContextFileName(process.env.OBSIDIAN_CONTEXT_FILE?.trim()),
    injectConventions,
    injectIntervalSecs,
  };
}

/** Singleton config instance used across the application. */
export const config = loadConfig();

/**
 * Updates the vault targeting at runtime without restarting the process.
 * Called by the tray app via IPC when the user changes the vault in Preferences
 * so the MCP session does not need to be re-established.
 */
export function setVault(vault: string | undefined): void {
  config.vault = vault;
}

/**
 * Updates injection settings at runtime without restarting the process.
 * Called by the tray app via IPC when the user changes injection preferences.
 *
 * The interval is passed through {@link sanitizeInterval} so an out-of-range,
 * non-integer, or string value from the IPC boundary can never disable the
 * injection TTL guard (which would re-inject conventions on every tool call).
 */
export function setInjectionConfig(enabled: boolean, intervalSecs: number): void {
  config.injectConventions = enabled;
  config.injectIntervalSecs = sanitizeInterval(intervalSecs);
}
