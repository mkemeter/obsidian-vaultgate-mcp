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
}

/** Default conventions filename when `OBSIDIAN_CONTEXT_FILE` is unset. */
const DEFAULT_CONTEXT_FILE = "VAULTGATE.md";

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

  return {
    vault: rawVault || undefined,
    cliBin: process.env.OBSIDIAN_CLI_PATH || "obsidian",
    port,
    host: "127.0.0.1",
    contextFileName: normalizeContextFileName(process.env.OBSIDIAN_CONTEXT_FILE?.trim()),
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
