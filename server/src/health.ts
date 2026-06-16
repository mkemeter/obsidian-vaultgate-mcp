import * as fs from "node:fs";
import { config } from "./config.js";

/**
 * Verifies the Obsidian CLI binary exists on disk before the server accepts
 * any connections.
 *
 * Only checks file existence — does NOT run the binary, so Obsidian is not
 * launched as a side-effect of starting the MCP server. Individual tool calls
 * will fail with a helpful "Obsidian is not running" message if Obsidian
 * happens to be closed when a tool is invoked.
 *
 * Prints a detailed, actionable error message to stderr and exits with
 * code 1 if the binary cannot be found.
 */
export async function runHealthCheck(): Promise<void> {
  if (!fs.existsSync(config.cliBin)) {
    process.stderr.write(
      `\n` +
        `ERROR: Obsidian CLI binary not found at: ${config.cliBin}\n\n` +
        `Troubleshooting:\n` +
        `  1. Ensure Obsidian v1.12.4+ is installed.\n` +
        `  2. Enable the CLI: Settings → General → Command line interface → Register CLI\n` +
        `  3. If the binary is not on PATH, set:\n` +
        `       OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian\n\n`
    );
    process.exit(1);
  }
}
