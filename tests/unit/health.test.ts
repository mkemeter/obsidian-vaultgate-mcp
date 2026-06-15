import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

import * as nodefs from "node:fs";
const mockExistsSync = vi.mocked(nodefs.existsSync);

describe("runHealthCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves without error when the CLI binary exists on disk", async () => {
    mockExistsSync.mockReturnValue(true);
    const { runHealthCheck } = await import("../../src/health.js");
    await expect(runHealthCheck()).resolves.toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith("obsidian");
  });

  it("writes an actionable error to stderr and exits when binary is missing", async () => {
    mockExistsSync.mockReturnValue(false);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    const { runHealthCheck } = await import("../../src/health.js?v=fail");
    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR: Obsidian CLI binary not found"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Register CLI"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
