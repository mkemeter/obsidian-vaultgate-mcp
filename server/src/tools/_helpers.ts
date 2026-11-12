import { z } from "zod";
import { config } from "../config.js";

/**
 * Zod schema for the `dryRun` parameter used by all write tools.
 *
 * Accepts both native booleans and their string representations so that
 * MCP clients which serialise parameters as strings (e.g. `"false"`) work
 * correctly instead of silently falling back to the `true` default.
 *
 * The schema advertises `type: ["boolean", "string"]` in its JSON Schema so
 * that strict clients (e.g. JWD) do not reject the string form before it
 * reaches the server. The transform then normalises both to a boolean.
 *
 * Accepted values that resolve to `false` (execute): `false`, `"false"`, `"0"`, `"no"`
 * Everything else (including omitted) resolves to `true` (preview only).
 */
export const dryRunSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === false || v === "false" || v === "0" || v === "no") return false;
    return true; // true, "true", undefined, any other string → preview
  })
  .default(true)
  .describe(
    "When true (default), returns a preview without executing. " +
      "Set to false only after explicit user confirmation."
  );

/**
 * Zod schema for optional boolean parameters that may arrive as strings from
 * MCP clients that serialise all parameters as strings (e.g. JWD).
 *
 * Advertises `anyOf: [boolean, string]` in JSON Schema so strict clients do
 * not reject string inputs before they reach the server.
 */
export const optionalBoolSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v): boolean | undefined => {
    if (v === undefined) return undefined;
    if (v === false || v === "false" || v === "0" || v === "no") return false;
    return true;
  });

/**
 * Zod schema for required boolean parameters that may arrive as strings.
 * Same coercion as optionalBoolSchema but without the optional/undefined path.
 */
export const requiredBoolSchema = z.union([z.boolean(), z.string()]).transform((v): boolean => {
  if (v === false || v === "false" || v === "0" || v === "no") return false;
  return true;
});

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
  return `[DRY RUN] Would execute: ${fullCommand}\nNo changes made. Set dryRun=false to execute.`;
}

/**
 * Extracts a message string from an unknown catch-clause value without an
 * `as Error` type assertion. Avoids untyped tokens flagged by type-coverage.
 *
 * @param e  The caught value.
 * @returns  `e.message` if `e` is an `Error`, otherwise `String(e)`.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
export function buildFileArgs(file: string | undefined, path: string | undefined): string[] {
  if (path?.trim()) return [`path=${path}`];
  if (file?.trim()) return [`file=${file}`];
  return [];
}

/**
 * Per-platform content length limits (characters) for the Obsidian CLI `content=` argument.
 *
 * Obsidian forwards CLI arguments through its IPC pipe, parsing each pipe chunk as JSON.
 * When an argument crosses a chunk boundary the message is corrupted or dropped (GH #10).
 * The failure threshold follows the OS default pipe-buffer size:
 *   - Windows: ~4 KB pipe buffer → hard crash, arg dropped entirely (`,,` in JSON)
 *   - macOS:   ~8 KB pipe buffer → silent UTF-8 corruption at the boundary
 *   - Linux:   ~64 KB pipe buffer → not a practical concern; no limit applied
 *
 * Values are set conservatively below the respective pipe-buffer size to leave room for
 * the `content=` prefix, path, vault name, and any quoting/escaping overhead.
 */
export const WIN32_CONTENT_LIMIT = 3 * 1024; // stay well under the 4 KB Windows pipe buffer
export const DARWIN_CONTENT_LIMIT = 7 * 1024; // stay well under the 8 KB macOS pipe buffer

/**
 * Returns an error response if `content` exceeds the platform's Obsidian CLI argument size
 * limit, or `null` if the check passes (content is within limits, or the platform is Linux
 * or another OS where the limit is not a practical concern).
 *
 * Callers should invoke this guard after the `dryRun` early-return but before calling
 * `runObsidian`, so previews are never blocked.
 *
 * @param content   The content string to check.
 * @param strategy  Actionable guidance for the caller on how to split the write.
 */
export function contentSizeGuard(content: string, strategy: string) {
  let limit: number | undefined;
  let platformName: string | undefined;
  if (process.platform === "win32") {
    limit = WIN32_CONTENT_LIMIT;
    platformName = "Windows";
  } else if (process.platform === "darwin") {
    limit = DARWIN_CONTENT_LIMIT;
    platformName = "macOS";
  }

  if (limit === undefined || content.length <= limit) return null;

  const kb = (content.length / 1024).toFixed(1);
  const limitKb = (limit / 1024).toFixed(0);
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Content too large for the Obsidian CLI on ${platformName} ` +
          `(${kb} KB; limit ~${limitKb} KB per call).\n` +
          strategy,
      },
    ],
    isError: true as const,
  };
}
