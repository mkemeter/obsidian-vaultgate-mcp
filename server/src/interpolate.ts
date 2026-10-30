import * as os from "node:os";
import { getActiveScope, isScopingEnabled } from "./scope.js";

/** Current MCP client name — captured from the MCP `initialize` handshake. */
let clientName = "unknown";

/**
 * Records the MCP client name from the `initialize` request so that `{{client}}`
 * resolves correctly at injection time.
 *
 * Called by the server's `initialize` handler before conventions are injected.
 */
export function setClientName(name: string): void {
  clientName = name;
}

function getUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Resolves `{{variable}}` placeholders in vault conventions content at injection time.
 *
 * Supported variables:
 * - `{{date}}`   — current UTC date (YYYY-MM-DD)
 * - `{{time}}`   — current local time (HH:MM, 24 h)
 * - `{{day}}`    — current local day of week (Monday–Sunday)
 * - `{{user}}`   — OS username of the process owner
 * - `{{scope}}`  — active vault scope name; empty string when scoping is disabled
 * - `{{client}}` — MCP client name from the `initialize` handshake (`"unknown"` until connected)
 *
 * Unknown placeholders (e.g. `{{foo}}`) are left as-is so typos stay visible.
 */
export function resolveInterpolations(text: string): string {
  const now = new Date();
  const vars: Record<string, string> = {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    // getDay() returns 0–6, always a valid index
    day: DAYS[now.getDay()] as string,
    user: getUserName(),
    scope: isScopingEnabled() ? getActiveScope() : "",
    client: clientName,
  };
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}
