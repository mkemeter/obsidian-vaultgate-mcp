#!/usr/bin/env node
/**
 * `obsidian-vaultgate-mcp-uninstall` — shell-agnostic teardown.
 *
 * Runs the platform's deploy/uninstall script (removes the auto-start mechanism, the npm
 * package, and the embedding cache) without a platform-specific shell. Logic lives in
 * {@link file://./installer.ts}; this shim only maps the exit to a process code.
 */
import { runInstaller } from "./installer.js";

runInstaller("uninstall").catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
