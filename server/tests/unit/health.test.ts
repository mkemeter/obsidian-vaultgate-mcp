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

describe("runHealthCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves without error when the CLI binary exists and is a file", async () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);
    const { runHealthCheck } = await import("../../src/health.js");
    await expect(runHealthCheck()).resolves.toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith("obsidian");
  });

  it("writes an actionable error to stderr and exits when binary is missing", async () => {
    mockExistsSync.mockReturnValue(false);
    // process.exit is stubbed to a no-op below, so execution falls through to
    // the statSync guard; stub it to a file so the fall-through doesn't throw.
    mockStatSync.mockReturnValue({ isFile: () => true } as fs.Stats);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { runHealthCheck } = await import("../../src/health.js?v=fail");
    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("ERROR: Obsidian CLI binary not found")
    );
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

    const { runHealthCheck } = await import("../../src/health.js?v=dir");
    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("points to a directory, not the Obsidian binary")
    );
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

    const { runHealthCheck } = await import("../../src/health.js?v=eacces");
    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("not executable"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
