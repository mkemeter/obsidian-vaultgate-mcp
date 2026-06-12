import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Opens a URI via the platform's default URI handler.
 * Exported separately for testability (tools mock runUri; uri.test.ts mocks execFile).
 *
 *   macOS  : execFile('open', [uri])
 *   Windows: execFile('cmd', ['/c', 'start', '', uri])  ← empty title required!
 *   Linux  : execFile('xdg-open', [uri])
 */
export async function openUri(uri: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", uri], { timeout: 10_000 });
    } else if (process.platform === "darwin") {
      await execFileAsync("open", [uri], { timeout: 10_000 });
    } else {
      await execFileAsync("xdg-open", [uri], { timeout: 10_000 });
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      const launcher =
        process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      throw new Error(
        `URI launcher not found: "${launcher}"\n  Cannot open Obsidian URI on this platform.`
      );
    }
    throw new Error(`URI open error: ${err.stderr?.trim() || err.message}`);
  }
}

/**
 * Builds an obsidian:// URI and opens it via openUri.
 * Injects vault from config automatically (same pattern as runObsidian).
 * Uses encodeURIComponent — NOT URLSearchParams — to avoid '+' encoding in file paths.
 */
export async function runUri(action: string, params: Record<string, string>): Promise<void> {
  const allParams: Record<string, string> = {};
  if (config.vault) allParams.vault = config.vault;
  for (const [k, v] of Object.entries(params)) allParams[k] = v;

  const query = Object.entries(allParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  await openUri(query ? `obsidian://${action}?${query}` : `obsidian://${action}`);
}
