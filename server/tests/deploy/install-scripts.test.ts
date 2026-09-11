/**
 * Deploy-script regression — shell-quoting bugs in the POSIX installers (bug 8).
 *
 * Both scripts run for real under `bash` against a sandboxed HOME with
 * `launchctl` / `systemctl` / `npm` stubbed via a fake PATH prefix, so no real
 * service is ever touched:
 *
 *   - launchd/install.sh: the `node -e` that resolves MCP_SCRIPT interpolates
 *     the detected path into a SINGLE-QUOTED JS string literal
 *     (`const p='$MCP_PATH'`). Any single quote in the install path is a JS
 *     syntax error → the command substitution fails → `set -euo pipefail`
 *     kills the installer BEFORE the plist is written.
 *
 *   - systemd/install.sh: the unit file is written with unquoted values
 *     (`ExecStart=${NODE_PATH} ${MCP_SCRIPT}`,
 *     `Environment=OBSIDIAN_CLI_PATH=${OBSIDIAN_PATH}`). systemd splits an
 *     unquoted ExecStart on whitespace, so any path containing a space is
 *     silently truncated (and the env var value is split too).
 *
 * POSIX scripts — skipped on win32 (bash + launchd/systemd layout).
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, skipIf } from "vitest";

const isWin32 = process.platform === "win32";

const LAUNCHD_INSTALL = fileURLToPath(new URL("../../deploy/launchd/install.sh", import.meta.url));
const SYSTEMD_INSTALL = fileURLToPath(new URL("../../deploy/systemd/install.sh", import.meta.url));

function writeStub(dir: string, name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, "utf-8");
  fs.chmodSync(p, 0o755);
  return p;
}

interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function runInstaller(
  script: string,
  opts: { home: string; stubDir: string; stdin: string; extraEnv?: Record<string, string> }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn("bash", [script], {
      env: {
        ...process.env,
        HOME: opts.home,
        PATH: `${opts.stubDir}:${process.env.PATH ?? ""}`,
        ...opts.extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.stdin?.on("error", () => {
      /* ignore EPIPE — the script may exit before consuming all stdin */
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin?.write(opts.stdin);
    child.stdin?.end();
  });
}

describe.skipIf(isWin32)("deploy — launchd/install.sh", () => {
  it("completes and writes the plist when the install path contains a single quote (regression)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "vg-launchd-"));
    try {
      const home = path.join(base, "home");
      fs.mkdirSync(home, { recursive: true });
      // A PATH entry whose NAME contains a single quote: every binary the
      // installer resolves (`which obsidian-vaultgate-mcp`, `which obsidian`,
      // `launchctl`) lives under it, so the detected paths carry the quote.
      const stubDir = path.join(base, "O'Brien-bin");
      fs.mkdirSync(stubDir, { recursive: true });
      const stubLog = path.join(base, "launchctl.log");
      // `\$` keeps the shell parameter expansion literal inside this JS template.
      writeStub(stubDir, "launchctl", `echo "launchctl $*" >> "\${VG_STUB_LOG:-/dev/null}"`);
      writeStub(stubDir, "obsidian-vaultgate-mcp", "exit 0");
      writeStub(stubDir, "obsidian", "exit 0");

      const { code, out, err } = await runInstaller(LAUNCHD_INSTALL, {
        home,
        stubDir,
        stdin: "TestVault\n",
        extraEnv: { VG_STUB_LOG: stubLog },
      });

      expect(
        code,
        `installer exited ${code}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`
      ).toBe(0);

      const plist = path.join(home, "Library", "LaunchAgents", "com.obsidian-vaultgate-mcp.plist");
      expect(fs.existsSync(plist), "plist was not written").toBe(true);
      const content = fs.readFileSync(plist, "utf-8");

      // ProgramArguments must carry the FULL path — including the quote.
      // (The historical failure mode leaves the slot empty or truncated.)
      const mcpBin = path.join(stubDir, "obsidian-vaultgate-mcp");
      expect(content).toContain(`<string>${mcpBin}</string>`);
      expect(content).toContain("<string>TestVault</string>");

      // The agent must have been loaded (a bare `load`, not only `unload`).
      const logContent = fs.readFileSync(stubLog, "utf-8");
      expect(logContent).toMatch(/^launchctl load /m);
      expect(logContent).toContain(plist);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});

describe.skipIf(isWin32)("deploy — systemd/install.sh", () => {
  it("writes quoted ExecStart/Environment lines when paths contain spaces (regression)", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "vg-systemd-"));
    try {
      const home = path.join(base, "home");
      fs.mkdirSync(home, { recursive: true });
      // A PATH entry with a SPACE in its name: the fake `obsidian` (and the
      // systemctl/npm stubs) live under it, so the detected CLI path carries
      // the space.
      const stubDir = path.join(base, "spaced stub");
      fs.mkdirSync(stubDir, { recursive: true });
      const stubLog = path.join(base, "systemctl.log");
      writeStub(stubDir, "systemctl", `echo "systemctl $*" >> "\${VG_STUB_LOG:-/dev/null}"`);
      // A fake npm global root (also containing a space) with the package.
      const npmRoot = path.join(base, "npm global root");
      const pkgBuild = path.join(npmRoot, "obsidian-vaultgate-mcp", "build");
      fs.mkdirSync(pkgBuild, { recursive: true });
      fs.writeFileSync(path.join(pkgBuild, "index.js"), "// stub\n", "utf-8");
      writeStub(stubDir, "npm", `echo "${npmRoot}"`);
      writeStub(stubDir, "obsidian", "exit 0");

      const { code, out, err } = await runInstaller(SYSTEMD_INSTALL, {
        home,
        stubDir,
        stdin: "TestVault\n",
        extraEnv: { VG_STUB_LOG: stubLog },
      });

      expect(
        code,
        `installer exited ${code}\n--- stdout ---\n${out}\n--- stderr ---\n${err}`
      ).toBe(0);

      const unit = path.join(home, ".config", "systemd", "user", "obsidian-vaultgate-mcp.service");
      expect(fs.existsSync(unit), "unit file was not written").toBe(true);
      const lines = fs.readFileSync(unit, "utf-8").split("\n");
      const execStart = lines.find((l) => l.startsWith("ExecStart="));
      const cliEnv = lines.find((l) => l.startsWith("Environment=OBSIDIAN_CLI_PATH="));

      // Each path argument must be its own double-quoted token — systemd
      // splits unquoted ExecStart values on whitespace.
      expect(execStart, `ExecStart line: ${JSON.stringify(execStart)}`).toMatch(
        /ExecStart="[^"]+"\s+"[^"]*index\.js"/
      );
      expect(cliEnv, `Environment line: ${JSON.stringify(cliEnv)}`).toMatch(
        /^Environment=OBSIDIAN_CLI_PATH="[^"]+"$/
      );

      // And the service must have been enabled.
      const logContent = fs.readFileSync(stubLog, "utf-8");
      expect(logContent).toContain("enable");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});
