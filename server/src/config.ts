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
