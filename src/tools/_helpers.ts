import { config } from "../config.js";

/**
 * Returns a dry-run preview string describing the CLI command that
 * *would* be executed, without actually running it.
 *
 * The preview includes the vault prefix when configured, so users see
 * exactly what would run — including any vault targeting.
 *
 * @param args  CLI args as they would be passed to `runObsidian`.
 * @returns     Human-readable preview message.
 */
export function dryRunPreview(args: string[]): string {
  const vaultPrefix = config.vault ? [`vault=${config.vault}`] : [];
  const fullCommand = ["obsidian", ...vaultPrefix, ...args].join(" ");
  return (
    `[DRY RUN] Would execute: ${fullCommand}\n` +
    `No changes made. Set dryRun=false to execute.`
  );
}

/**
 * Builds the `file=` or `path=` argument array for commands that accept
 * a file target.
 *
 * - If `path` is provided, uses `path=<value>` (exact vault-root path).
 * - If only `file` is provided, uses `file=<value>` (wikilink resolution).
 * - If neither is provided, returns an empty array (targets the active file).
 *
 * @param file  Wikilink-style note name.
 * @param path  Exact vault-root path (takes precedence over file).
 * @returns     Zero or one CLI argument strings.
 */
export function buildFileArgs(
  file: string | undefined,
  path: string | undefined
): string[] {
  if (path !== undefined) return [`path=${path}`];
  if (file !== undefined) return [`file=${file}`];
  return [];
}
