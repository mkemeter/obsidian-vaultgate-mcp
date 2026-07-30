#!/usr/bin/env node
/**
 * `obsidian-vaultgate-mcp-install` — shell-agnostic auto-start setup.
 *
 * Runs the platform's deploy/install script (launchd / systemd / Task Scheduler) so the
 * user never has to resolve a path or use a platform-specific shell. Logic lives in
 * {@link file://./installer.ts}; this shim only maps the exit to a process code.
 */
import { runInstaller } from "./installer.js";

runInstaller("install").catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
