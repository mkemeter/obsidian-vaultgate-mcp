/**
 * First-run auto-detection of Obsidian + vault.
 *
 * Extracted from `main.ts` so the decision logic (number-of-vaults heuristic,
 * "don't second-guess existing config") can be unit-tested without standing
 * up an Electron app context.
 */

import {
  detectObsidianPath,
  getRegisteredVaults,
  hasConfig,
  saveConfig,
} from "./config-store.js";

/**
 * Populates the config store with auto-detected Obsidian binary + vault on
 * first launch. No-op once any config has been saved (we trust the user's
 * settings on every subsequent launch).
 *
 * Vault selection rules:
 *   - exactly one vault registered → pick it
 *   - zero or multiple vaults     → leave empty (= use Obsidian's active vault)
 */
export function autoDetectFirstRun(): void {
  if (hasConfig()) return; // user has saved before — don't second-guess them

  const obsidianPath = detectObsidianPath();
  const vaults = getRegisteredVaults();

  // Single vault detected → auto-pick. Multiple → leave blank (default = active).
  const vault = vaults.length === 1 ? (vaults[0]?.name ?? "") : "";

  saveConfig({ obsidianPath, vault });
}
