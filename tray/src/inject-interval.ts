/**
 * Injection interval helpers used by the Preferences window.
 *
 * Kept in their own module so the validation rule can be unit-tested without
 * Electron. The renderer (`prefs.js`) duplicates a lightweight check for instant
 * feedback, but this module is the source of truth for the tray.
 */

/** Default re-injection interval in seconds. */
export const DEFAULT_INJECT_INTERVAL = 30;

/** Minimum allowed injection interval in seconds. */
export const MIN_INJECT_INTERVAL = 1;

/** Maximum allowed injection interval in seconds (1 hour). */
export const MAX_INJECT_INTERVAL = 3600;

/**
 * Returns `true` if `value` is a valid injection interval: an integer between
 * {@link MIN_INJECT_INTERVAL} and {@link MAX_INJECT_INTERVAL} inclusive.
 *
 * @param value  Candidate interval value (number or numeric string).
 */
export function isValidInterval(value: unknown): boolean {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return Number.isInteger(n) && n >= MIN_INJECT_INTERVAL && n <= MAX_INJECT_INTERVAL;
}

/**
 * Normalises an injection interval for persistence: parses if string, falls
 * back to the default when absent or invalid.
 *
 * @param raw  Candidate value from the Preferences field.
 * @returns    A valid integer interval, or the default.
 */
export function normalizeInterval(raw: string | number | undefined): number {
  // An empty string needs no special case: parseInt("") is NaN, which
  // isValidInterval rejects, so it falls back to the default like any other
  // invalid input.
  if (raw === undefined) return DEFAULT_INJECT_INTERVAL;
  const n = typeof raw === "string" ? parseInt(raw, 10) : Math.trunc(raw);
  return isValidInterval(n) ? n : DEFAULT_INJECT_INTERVAL;
}
