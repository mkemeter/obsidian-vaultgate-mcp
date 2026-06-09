import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/cli.js", () => ({
  runObsidian: vi.fn(),
}));
vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const { runObsidian } = await import("../../src/cli.js");
const mockRunObsidian = vi.mocked(runObsidian);

describe("runHealthCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves without error when obsidian CLI responds", async () => {
    mockRunObsidian.mockResolvedValue("Available commands: ...");
    const { runHealthCheck } = await import("../../src/health.js");
    await expect(runHealthCheck()).resolves.toBeUndefined();
    expect(mockRunObsidian).toHaveBeenCalledWith(["help"]);
  });

  it("writes an actionable error to stderr and exits when CLI is unreachable", async () => {
    mockRunObsidian.mockRejectedValue(
      new Error('Obsidian CLI binary not found: "obsidian"')
    );

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    const { runHealthCheck } = await import("../../src/health.js?v=fail");
    await runHealthCheck();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR: Cannot reach Obsidian CLI"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("Register CLI"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
