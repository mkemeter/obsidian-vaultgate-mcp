#!/usr/bin/env node
/**
 * `obsidian-vaultgate-mcp-install` — shell-agnostic auto-start setup.
 *
 * Runs the platform's deploy/install script (launchd / systemd / Task Scheduler) so the
 * user never has to resolve a path or use a platform-specific shell. Extra arguments are
 * forwarded to the deploy script verbatim (Windows: `-ObsidianPath … -VaultName …
 * -NonInteractive`). Logic lives in {@link file://./installer.ts}; this shim maps the
 * exit to a process code.
 */
import { runInstaller } from "./installer.js";

runInstaller("install", process.argv.slice(2)).catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
