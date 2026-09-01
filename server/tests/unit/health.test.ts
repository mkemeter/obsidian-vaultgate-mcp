import type * as fs from "node:fs";
import * as nodefs from "node:fs";
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
