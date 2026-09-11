import type * as fs from "node:fs";
import * as nodefs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the fs functions we exercise but keep the real `constants` object so that
// `fs.constants.X_OK` in health.ts resolves to its true numeric value.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
    statSync: vi.fn(),
    accessSync: vi.fn(),
  };
});
vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const mockExistsSync = vi.mocked(nodefs.existsSync);
const mockStatSync = vi.mocked(nodefs.statSync);
const mockAccessSync = vi.mocked(nodefs.accessSync);

// Top-level import (same approach as cli.test.ts) so Stryker can properly
// apply mutations to the source and have the tests catch those mutations.
// Per-test query-string imports (e.g. "health.js?v=fail") create a separate
// Vitest module-registry key that Stryker does not patch, causing all
// StringLiteral mutants in health.ts to survive even when assertions exist.
const { runHealthCheck } = await import("../../src/health.js");

describe("runHealthCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves without error when the CLI binary exists and is a file", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
    await expect(runHealthCheck()).resolves.toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith("obsidian");
  });

  it("writes an actionable error to stderr and exits when binary is missing", async () => {
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ERROR: Obsidian CLI binary not found")
    );
    // Pin exact hint substrings to kill StringLiteral mutants on those lines
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Troubleshooting:"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Ensure Obsidian v1.8.9+"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("OBSIDIAN_CLI_PATH="));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Register CLI"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // regression: gh-issue-11 — OBSIDIAN_CLI_PATH pointing at a directory (not
  // Obsidian.exe) passed existsSync and only failed later at execFile.
  it("writes an actionable error to stderr and exits when the path is a directory", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => false } as fs.Stats);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("points to a directory, not the Obsidian binary")
    );
    // Pin exact hint substrings to kill StringLiteral mutants on those lines
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Set it to the executable file itself")
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Windows:"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("macOS:"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // regression: a binary that exists and is a file but lacks execute permission
  // passed the health check, then failed opaquely at execFile with EACCES and a
  // misleading "Register CLI" hint.
  it("writes an actionable error to stderr and exits when the binary is not executable", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
    mockAccessSync.mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("not executable"));
    // Pin exact hint substrings to kill StringLiteral mutants on those lines
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Fix the file permissions")
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("chmod +x"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// PATH resolution — regression: bare CLI names must be resolved via PATH.
//
// The documented default (OBSIDIAN_CLI_PATH unset) is the bare CLI name
// `obsidian`, which must be found by scanning PATH. runHealthCheck() used to
// call fs.existsSync("obsidian") — a CWD-relative filesystem check — so the
// default configuration failed from any cwd that did not happen to contain a
// file named `obsidian`, contradicting the documented behavior.
// ---------------------------------------------------------------------------

describe("runHealthCheck — PATH resolution for bare CLI names", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // regression (red until fixed): a bare CLI name that resolves to an
  // executable on PATH must pass the health check instead of exiting 1.
  //
  // Fix-surface note: the fake CLI is a REAL executable file in a REAL temp
  // dir prepended to the REAL PATH, so the test is forward-compatible with
  // either resolution strategy — an fs-based PATH scan (the mocked
  // existsSync/statSync fall through to the real fs for resolved paths) or a
  // shell-based one (`which` / `command -v` bypass the mocks entirely and
  // find the real file via the real PATH). The only contract pinned here is
  // "the fix must consult PATH at all".
  it("resolves without exiting when the bare CLI name is an executable on PATH", async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const dir = realFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "vg-health-path-"));
    const bin = nodePath.join(dir, "obsidian");
    realFs.writeFileSync(bin, "#!/bin/sh\nexit 0\n", "utf-8");
    realFs.chmodSync(bin, 0o755);

    const origPath = process.env.PATH;
    const origPathCase = process.env.Path;
    process.env.PATH = `${dir}${nodePath.delimiter}${origPath ?? ""}`;
    // Node treats env var names case-insensitively on Windows — keep both in sync.
    process.env.Path = process.env.PATH;

    try {
      // The bare name does NOT exist CWD-relative; the on-PATH binary does.
      mockExistsSync.mockImplementation((p: string) =>
        p === "obsidian" ? false : realFs.existsSync(p)
      );
      mockStatSync.mockImplementation((p: string) =>
        realFs.existsSync(p) ? realFs.statSync(p) : ({ isFile: () => false } as fs.Stats)
      );
      // accessSync keeps its default no-op (the real file is 0o755 anyway).

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
      await runHealthCheck();
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    } finally {
      if (origPath === undefined) delete process.env.PATH;
      else process.env.PATH = origPath;
      if (origPathCase === undefined) delete process.env.Path;
      else process.env.Path = origPathCase;
      realFs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // green pin: a CLI absent from BOTH the cwd and PATH must still be rejected
  // with exit code 1 — the PATH-resolution fix must not turn this into a pass.
  //
  // Fix-contract note: this pin asserts the error message contains
  // "not found". Keep that substring in the fixed error text (e.g.
  // "'obsidian' not found (checked CWD and PATH)"); if the wording changes,
  // update this assertion alongside the fix.
  it("still exits 1 with a not-found error when the CLI is on neither CWD nor PATH", async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const emptyDir = realFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "vg-health-empty-"));
    const origPath = process.env.PATH;
    const origPathCase = process.env.Path;
    process.env.PATH = emptyDir;
    process.env.Path = emptyDir;

    try {
      mockExistsSync.mockReturnValue(false);
      mockStatSync.mockReturnValue({ isFile: () => false } as fs.Stats);

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

      await runHealthCheck();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
      expect(exitSpy).toHaveBeenCalledWith(1);
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    } finally {
      if (origPath === undefined) delete process.env.PATH;
      else process.env.PATH = origPath;
      if (origPathCase === undefined) delete process.env.Path;
      else process.env.Path = origPathCase;
      realFs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
