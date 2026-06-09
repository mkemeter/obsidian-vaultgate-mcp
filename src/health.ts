import { runObsidian } from "./cli.js";
import { config } from "./config.js";

/**
 * Verifies the Obsidian CLI binary is reachable before the server accepts
 * any connections.
 *
 * Runs `obsidian help` (a safe, read-only command) and checks for a
 * successful response. If Obsidian is not currently running, the CLI
 * will auto-start it — this is expected and documented behaviour.
 *
 * Prints a detailed, actionable error message to stderr and exits with
 * code 1 if the binary cannot be reached, so launchd's KeepAlive does not
 * spin in a silent restart loop.
 *
 * NOTE: Because this runs `obsidian help`, launching obsidian-mcp-http
 * at login (via launchd) will also launch Obsidian at login. This is
 * intentional for daily-use setups and is documented in launchd/README.md.
 */
export async function runHealthCheck(): Promise<void> {
  try {
    await runObsidian(["help"]);
  } catch (error) {
    const err = error as Error;
    process.stderr.write(
      `\n` +
        `ERROR: Cannot reach Obsidian CLI.\n` +
        `  ${err.message}\n\n` +
        `Troubleshooting:\n` +
        `  1. Ensure Obsidian v1.12.4+ is installed.\n` +
        `  2. Enable the CLI: Settings → General → Command line interface → Register CLI\n` +
        `  3. If the binary is not on PATH, set:\n` +
        `       OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian\n` +
        `  4. Current binary path being used: ${config.cliBin}\n\n`
    );
    process.exit(1);
  }
}
