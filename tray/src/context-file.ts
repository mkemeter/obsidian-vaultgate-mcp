/**
 * Vault conventions filename helpers used by the Preferences window.
 *
 * Kept in their own module so the validation rule can be unit-tested without
 * Electron. The renderer (`prefs.js`) duplicates a lightweight check for instant
 * feedback, but this module is the source of truth for the tray.
 */

/** Default conventions filename when the user has not configured one. */
export const DEFAULT_CONTEXT_FILE = "VAULTGATE.md";

/**
 * Returns `true` if `raw` is a valid conventions filename: a bare filename in
 * the vault root (no path separators, no `..`) ending in `.md`. An empty or
 * whitespace-only value is considered valid because it falls back to the
 * default via {@link normalizeContextFileName}.
 *
 * @param raw  Candidate filename from the Preferences field.
 */
export function isValidContextFileName(raw: string | undefined): boolean {
  const trimmed = raw?.trim();
  if (!trimmed) return true; // empty → default is applied downstream
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return false;
  }
  return trimmed.toLowerCase().endsWith(".md");
}

/**
 * Normalises a conventions filename for persistence: trims it, falls back to
 * the default when empty, and returns the bare filename otherwise.
 *
 * Validation is intentionally not thrown here — the Preferences UI blocks an
 * invalid value before save via {@link isValidContextFileName}, and the server
 * enforces the same rule authoritatively at startup.
 *
 * @param raw  Candidate filename from the Preferences field.
 * @returns    A trimmed filename, or the default when empty.
 */
export function normalizeContextFileName(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed || DEFAULT_CONTEXT_FILE;
}
