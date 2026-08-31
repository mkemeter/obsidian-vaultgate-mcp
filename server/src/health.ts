import * as fs from "node:fs";
import { config } from "./config.js";

/**
 * Verifies the Obsidian CLI binary exists on disk before the server accepts
 * any connections.
 *
 * Only checks the filesystem — does NOT run the binary, so Obsidian is not
 * launched as a side-effect of starting the MCP server. If Obsidian is closed
 * when a tool is later invoked, the Obsidian CLI launches it on the first
 * command (per the Obsidian CLI docs); if the CLI is not registered, the tool
 * call fails and `runObsidian` (cli.ts) appends actionable "Register CLI"
 * guidance to whatever Obsidian reports.
 *
 * Three failure modes are caught eagerly here, all exiting with code 1 and an
 * actionable stderr message:
 *   1. The path does not exist at all.
 *   2. The path exists but is a directory, not the binary file — a common
 *      Windows misconfiguration where `OBSIDIAN_CLI_PATH` points at the
 *      Obsidian install folder instead of `Obsidian.exe`.
 *   3. The path is a file but is not executable (Unix permissions) — otherwise
 *      it fails later at execFile with an opaque EACCES.
 */
export async function runHealthCheck(): Promise<void> {
  if (!fs.existsSync(config.cliBin)) {
    process.stderr.write(
      `\n` +
        `ERROR: Obsidian CLI binary not found at: ${config.cliBin}\n\n` +
        `Troubleshooting:\n` +
        `  1. Ensure Obsidian v1.8.9+ is installed.\n` +
        `  2. Enable the CLI: Settings → General → Command line interface → Register CLI\n` +
        `  3. If the binary is not on PATH, set:\n` +
        `       OBSIDIAN_CLI_PATH=/Applications/Obsidian.app/Contents/MacOS/obsidian\n\n`
    );
    process.exit(1);
  }

  // The path exists — make sure it points at the binary file, not a directory.
  // A directory would pass existsSync but fail at execFile time with an opaque
  // error (see cli.ts). On Windows this happens when OBSIDIAN_CLI_PATH is set to
  // the Obsidian install folder instead of Obsidian.exe.
  if (!fs.statSync(config.cliBin).isFile()) {
    process.stderr.write(
      `\n` +
        `ERROR: OBSIDIAN_CLI_PATH points to a directory, not the Obsidian binary:\n` +
        `       ${config.cliBin}\n\n` +
        `Set it to the executable file itself, for example:\n` +
        `  Windows: %LOCALAPPDATA%\\Programs\\Obsidian\\Obsidian.exe\n` +
        `  macOS:   /Applications/Obsidian.app/Contents/MacOS/obsidian\n\n`
    );
    process.exit(1);
  }

  // The path is a real file — make sure it is executable. A binary that exists
  // but lacks execute permission passes the checks above, then fails at execFile
  // time with an opaque EACCES (and cli.ts's generic "Register CLI" hint, which
  // is wrong for a permissions problem). X_OK is a no-op on Windows, where
  // executability is determined by file extension, so this only guards Unix.
  try {
    fs.accessSync(config.cliBin, fs.constants.X_OK);
  } catch {
    process.stderr.write(
      `\n` +
        `ERROR: Obsidian CLI binary is not executable: ${config.cliBin}\n\n` +
        `Fix the file permissions, for example:\n` +
        `  chmod +x "${config.cliBin}"\n\n`
    );
    process.exit(1);
  }
}
