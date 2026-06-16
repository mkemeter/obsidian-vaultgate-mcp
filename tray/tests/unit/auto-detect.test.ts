/**
 * Unit tests for `tray/src/auto-detect.ts`.
 *
 * The decision logic (number-of-vaults heuristic, "don't second-guess existing
 * config") is fully covered here — `main.ts` is just orchestration and stays
 * excluded from coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config-store.js", () => ({
  hasConfig: vi.fn(),
  detectObsidianPath: vi.fn(),
  getRegisteredVaults: vi.fn(),
  saveConfig: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

describe("autoDetectFirstRun", () => {
  it("is a no-op when the user has already saved config", async () => {
    const cs = await import("../../src/config-store.js");
    vi.mocked(cs.hasConfig).mockReturnValue(true);

    const { autoDetectFirstRun } = await import("../../src/auto-detect.js");
    autoDetectFirstRun();

    expect(cs.saveConfig).not.toHaveBeenCalled();
    expect(cs.detectObsidianPath).not.toHaveBeenCalled();
    expect(cs.getRegisteredVaults).not.toHaveBeenCalled();
  });

  it("auto-picks the single registered vault when exactly one is found", async () => {
    const cs = await import("../../src/config-store.js");
    vi.mocked(cs.hasConfig).mockReturnValue(false);
    vi.mocked(cs.detectObsidianPath).mockReturnValue("/Applications/Obsidian.app/Contents/MacOS/obsidian");
    vi.mocked(cs.getRegisteredVaults).mockReturnValue([{ name: "MyVault", path: "/x/MyVault" }]);

    const { autoDetectFirstRun } = await import("../../src/auto-detect.js");
    autoDetectFirstRun();

    expect(cs.saveConfig).toHaveBeenCalledWith({
      obsidianPath: "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      vault: "MyVault",
    });
  });

  it("leaves vault blank when multiple vaults are registered (defaults to Obsidian's active vault)", async () => {
    const cs = await import("../../src/config-store.js");
    vi.mocked(cs.hasConfig).mockReturnValue(false);
    vi.mocked(cs.detectObsidianPath).mockReturnValue("/path/to/obsidian");
    vi.mocked(cs.getRegisteredVaults).mockReturnValue([
      { name: "A", path: "/x/A" },
      { name: "B", path: "/x/B" },
    ]);

    const { autoDetectFirstRun } = await import("../../src/auto-detect.js");
    autoDetectFirstRun();

    expect(cs.saveConfig).toHaveBeenCalledWith({
      obsidianPath: "/path/to/obsidian",
      vault: "",
    });
  });

  it("leaves vault blank when zero vaults are registered (Obsidian not yet set up)", async () => {
    const cs = await import("../../src/config-store.js");
    vi.mocked(cs.hasConfig).mockReturnValue(false);
    vi.mocked(cs.detectObsidianPath).mockReturnValue("");
    vi.mocked(cs.getRegisteredVaults).mockReturnValue([]);

    const { autoDetectFirstRun } = await import("../../src/auto-detect.js");
    autoDetectFirstRun();

    expect(cs.saveConfig).toHaveBeenCalledWith({
      obsidianPath: "",
      vault: "",
    });
  });

  it("persists an empty obsidianPath when detection fails (the prefs window will prompt)", async () => {
    const cs = await import("../../src/config-store.js");
    vi.mocked(cs.hasConfig).mockReturnValue(false);
    vi.mocked(cs.detectObsidianPath).mockReturnValue("");
    vi.mocked(cs.getRegisteredVaults).mockReturnValue([{ name: "OnlyVault", path: "/x/OnlyVault" }]);

    const { autoDetectFirstRun } = await import("../../src/auto-detect.js");
    autoDetectFirstRun();

    expect(cs.saveConfig).toHaveBeenCalledWith({
      obsidianPath: "",
      vault: "OnlyVault",
    });
  });
});
