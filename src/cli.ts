import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Executes an Obsidian CLI command and returns its stdout.
 *
 * Uses `execFile` (not `exec`) to prevent shell injection — args are passed
 * as an array and are never interpolated into a shell string. This means
 * special characters in note names, content, or vault names are safe.
 *
 * If `config.vault` is set, prepends `vault="<name>"` as the first argument,
 * targeting that specific vault as documented in the Obsidian CLI spec.
 *
 * @param args  CLI arguments excluding the binary name.
 *              Example: `["search", "query=hello world", "limit=10"]`
 * @returns     Trimmed stdout string from the CLI process.
 * @throws      Error whose message contains the stderr output if the
 *              process exits with a non-zero code, or if the binary
 *              cannot be found.
 */
export async function runObsidian(args: string[]): Promise<string> {
  // Prepend vault targeting if configured. Must be the first argument
  // per the Obsidian CLI spec: `obsidian vault="My Vault" <command> ...`
  const fullArgs = config.vault
    ? [`vault=${config.vault}`, ...args]
    : [...args];

  try {
    const { stdout } = await execFileAsync(config.cliBin, fullArgs, {
      // 30-second timeout to avoid hanging if Obsidian stops responding
      timeout: 30_000,
      // Enough buffer for large vault listings or long note contents
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    // execFile throws an object with stderr when the process exits non-zero
    const err = error as NodeJS.ErrnoException & { stderr?: string };

    if (err.code === "ENOENT") {
      throw new Error(
        `Obsidian CLI binary not found: "${config.cliBin}"\n` +
          `  Set OBSIDIAN_CLI_PATH to the absolute path of the obsidian binary, or\n` +
          `  enable the CLI in Obsidian: Settings → General → Register CLI`
      );
    }

    const detail = err.stderr?.trim() || err.message;
    throw new Error(`Obsidian CLI error: ${detail}`);
  }
}
