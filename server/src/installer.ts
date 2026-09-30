import { spawn } from "node:child_process";
import * as path from "node:path";
import * as url from "node:url";

/** The install action a wrapper performs. */
export type InstallerAction = "install" | "uninstall";

/** A resolved child-process invocation: the executable and its argument vector. */
export interface InstallerCommand {
  /** Executable to spawn (never shell-interpolated). */
  command: string;
  /** Argument vector, passed verbatim to spawn (shell:false). */
  args: string[];
}

/**
 * Resolves the platform-specific command that runs a deploy script.
 *
 * Pure and side-effect-free so the platform branching is unit-testable without
 * spawning a process. Branch order matches {@link file://./uri.ts} (win32 → darwin → Linux).
 *
 *   Windows: powershell.exe -ExecutionPolicy Bypass -NoProfile -File <deployDir>\<action>.ps1
 *   macOS   : bash <deployDir>/<action>.sh
 *   Linux   : bash <deployDir>/<action>.sh  (install.sh dispatches to systemd internally)
 *
 * `-ExecutionPolicy Bypass` also clears the PowerShell execution-policy hurdle, so the
 * user never needs an elevated or pre-unblocked shell.
 *
 * @param action  Which deploy script to run.
 * @param platform  A `process.platform` value.
 * @param deployDir  Absolute path to the package's `deploy/` directory.
 * @param extraArgs  Forwarded verbatim after the script path — e.g. the
 *                   `-ObsidianPath … -VaultName … -NonInteractive` parameters of install.ps1.
 */
export function resolveInstallerCommand(
  action: InstallerAction,
  platform: NodeJS.Platform,
  deployDir: string,
  extraArgs: string[] = []
): InstallerCommand {
  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-ExecutionPolicy",
        "Bypass",
        "-NoProfile",
        "-File",
        path.join(deployDir, `${action}.ps1`),
        ...extraArgs,
      ],
    };
  }
  return {
    command: "bash",
    args: [path.join(deployDir, `${action}.sh`), ...extraArgs],
  };
}

/**
 * Runs the platform-appropriate deploy script for `action`, wiring the child's stdio
 * straight to this process's terminal so the script's interactive prompts (vault name,
 * Obsidian path) render and accept input.
 *
 * Requires a real TTY — or a run that cannot prompt: the deploy scripts prompt via
 * `read`/`Read-Host`, and inherited stdio is interactive only when the parent runs in a
 * console. A non-TTY run proceeds only for PowerShell targets (whose unattended path is
 * `-NonInteractive`, which skips every prompt) or when `-NonInteractive` is among
 * `extraArgs`. The `.sh` installers have no non-interactive mode, so a non-TTY POSIX run
 * is still rejected rather than allowed to hang on an invisible prompt.
 *
 * Invariant: once the child is spawned this function does nothing that reads package
 * files. The uninstall child runs `npm uninstall -g`, which deletes the package directory
 * (including this running `build/*.js`) mid-run. That is safe by OS semantics — script and
 * already-loaded JS files are not locked — *only* as long as we never touch package files
 * afterwards.
 *
 * @param action  Which deploy script to run.
 * @param extraArgs  Forwarded verbatim after the deploy script's path (spawned with
 *                   shell:false — no shell interpolation). On Windows these become
 *                   install.ps1 parameters; the .sh installers ignore them.
 * @returns Resolves when the child exits 0; rejects on non-zero exit or spawn failure.
 */
export function runInstaller(action: InstallerAction, extraArgs: string[] = []): Promise<void> {
  const canRunNonInteractive =
    process.platform === "win32" || extraArgs.includes("-NonInteractive");
  if (!process.stdin.isTTY && !canRunNonInteractive) {
    return Promise.reject(
      new Error(
        `${action} must be run from a terminal — it prompts you for your vault name.\n  Open a terminal and run: obsidian-vaultgate-mcp-${action}`
      )
    );
  }

  const deployDir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "deploy");
  const { command, args } = resolveInstallerCommand(action, process.platform, deployDir, extraArgs);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `Command not found: "${command}"\n  Cannot run the ${action} script on this platform.`
          )
        );
        return;
      }
      reject(new Error(`${action} failed to start: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${action} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}
