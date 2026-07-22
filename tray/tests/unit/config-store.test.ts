/**
 * Unit tests for `tray/src/config-store.ts`.
 *
 * Approach: vitest cannot spy on ESM namespace exports (`os.homedir` etc.),
 * so we mock the whole `node:fs` / `node:os` modules with hoisted state
 * objects we can mutate per test. This mirrors the pattern used by the root
 * project's `cli.test.ts`.
 *
 * Each test runs against a fresh temp directory via the mocked `app.getPath`
 * to keep config persistence real but isolated.
 */

import * as realFs from "node:fs";
import * as realOs from "node:os";
import * as realPath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state — controllable from individual tests.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => {
  return {
    homedir: "/home/test",
    fsExistsSync: undefined as ((p: unknown) => boolean) | undefined,
    fsReadFileSync: undefined as ((p: unknown) => string) | undefined,
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockState.homedir,
    default: { ...actual, homedir: () => mockState.homedir },
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: string) =>
      mockState.fsExistsSync ? mockState.fsExistsSync(p) : actual.existsSync(p),
    readFileSync: ((p: unknown, opts: unknown) =>
      mockState.fsReadFileSync
        ? mockState.fsReadFileSync(p)
        : (actual.readFileSync as (a: unknown, b: unknown) => Buffer | string)(p, opts)) as typeof actual.readFileSync,
    default: actual,
  };
});

let tmpUserData: string;
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => tmpUserData),
  },
}));

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

const originalPlatform = process.platform;

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

beforeEach(() => {
  vi.resetModules();
  mockState.homedir = realOs.homedir();
  mockState.fsExistsSync = undefined;
  mockState.fsReadFileSync = undefined;
  tmpUserData = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), "vaultgate-test-"));
});

afterEach(() => {
  // Reset platform + mock overrides BEFORE touching the real fs for cleanup —
  // otherwise a test that wired existsSync to throw would also break the
  // teardown (the mock is namespace-wide and applies to `realFs` too).
  setPlatform(originalPlatform);
  mockState.fsExistsSync = undefined;
  mockState.fsReadFileSync = undefined;
  if (tmpUserData && realFs.existsSync(tmpUserData)) {
    realFs.rmSync(tmpUserData, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// loadConfig / saveConfig / hasConfig
// ---------------------------------------------------------------------------

describe("loadConfig / saveConfig / hasConfig", () => {
  it("returns defaults on first run when no file exists", async () => {
    const { loadConfig, hasConfig } = await import("../../src/config-store.js");
    expect(hasConfig()).toBe(false);
    expect(loadConfig()).toEqual({
      vault: "",
      port: 3002,
      obsidianPath: "",
      contextFileName: "VAULTGATE.md",
      smartSearchReadyNotified: false,
    });
  });

  it("persists a partial patch and re-reads it on next load", async () => {
    const { saveConfig, loadConfig, hasConfig } = await import("../../src/config-store.js");
    saveConfig({ port: 4242, vault: "MyVault" });

    expect(hasConfig()).toBe(true);
    expect(loadConfig()).toEqual({
      vault: "MyVault",
      port: 4242,
      obsidianPath: "",
      contextFileName: "VAULTGATE.md",
      smartSearchReadyNotified: false,
    });
  });

  it("persists a custom conventions filename", async () => {
    const { saveConfig, loadConfig } = await import("../../src/config-store.js");
    saveConfig({ contextFileName: "CLAUDE.md" });
    expect(loadConfig().contextFileName).toBe("CLAUDE.md");
  });

  it("merges sequential patches without losing earlier fields", async () => {
    const { saveConfig, loadConfig } = await import("../../src/config-store.js");
    saveConfig({ vault: "First" });
    saveConfig({ port: 5000 });

    expect(loadConfig().vault).toBe("First");
    expect(loadConfig().port).toBe(5000);
  });

  it("falls back to defaults when the config file is corrupt JSON", async () => {
    const file = realPath.join(tmpUserData, "vaultgate-config.json");
    realFs.writeFileSync(file, "{not-valid-json", "utf-8");

    const { loadConfig } = await import("../../src/config-store.js");
    expect(loadConfig().port).toBe(3002);
  });

  it("creates the userData directory if it does not exist yet", async () => {
    const nestedUserData = realPath.join(tmpUserData, "nested", "dir");
    tmpUserData = nestedUserData;
    const { saveConfig } = await import("../../src/config-store.js");
    saveConfig({ vault: "v" });
    expect(realFs.existsSync(realPath.join(nestedUserData, "vaultgate-config.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectObsidianPath
// ---------------------------------------------------------------------------

describe("detectObsidianPath", () => {
  it("returns the macOS bundle path when it exists", async () => {
    setPlatform("darwin");
    mockState.fsExistsSync = (c) => c === "/Applications/Obsidian.app/Contents/MacOS/obsidian";

    const { detectObsidianPath } = await import("../../src/config-store.js");
    expect(detectObsidianPath()).toBe("/Applications/Obsidian.app/Contents/MacOS/obsidian");
  });

  it("returns the empty string when no candidate exists", async () => {
    setPlatform("darwin");
    mockState.fsExistsSync = () => false;

    const { detectObsidianPath } = await import("../../src/config-store.js");
    expect(detectObsidianPath()).toBe("");
  });

  it("returns the empty string on Linux when no binary is found", async () => {
    setPlatform("linux");
    mockState.fsExistsSync = () => false;

    const { detectObsidianPath } = await import("../../src/config-store.js");
    expect(detectObsidianPath()).toBe("");
  });

  it("treats fs.existsSync exceptions as 'not found' rather than propagating", async () => {
    setPlatform("darwin");
    mockState.fsExistsSync = () => {
      throw new Error("EACCES");
    };

    const { detectObsidianPath } = await import("../../src/config-store.js");
    expect(detectObsidianPath()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getRegisteredVaults
// ---------------------------------------------------------------------------

describe("getRegisteredVaults", () => {
  it("parses obsidian.json on macOS and returns name+path pairs", async () => {
    setPlatform("darwin");
    mockState.homedir = "/Users/test";
    mockState.fsReadFileSync = (p) => {
      if (typeof p === "string" && p.endsWith("obsidian.json")) {
        return JSON.stringify({
          vaults: {
            abc: { path: "/Users/test/Notes" },
            def: { path: "/Users/test/Workspace" },
          },
        });
      }
      throw new Error("ENOENT");
    };

    const { getRegisteredVaults } = await import("../../src/config-store.js");
    expect(getRegisteredVaults()).toEqual([
      { name: "Notes", path: "/Users/test/Notes" },
      { name: "Workspace", path: "/Users/test/Workspace" },
    ]);
  });

  it("returns an empty list when the file does not exist", async () => {
    setPlatform("darwin");
    mockState.fsReadFileSync = () => {
      throw new Error("ENOENT");
    };

    const { getRegisteredVaults } = await import("../../src/config-store.js");
    expect(getRegisteredVaults()).toEqual([]);
  });

  it("returns an empty list when the JSON is malformed", async () => {
    setPlatform("darwin");
    mockState.fsReadFileSync = () => "{not-json";

    const { getRegisteredVaults } = await import("../../src/config-store.js");
    expect(getRegisteredVaults()).toEqual([]);
  });

  it("returns an empty list when obsidian.json has no vaults key", async () => {
    setPlatform("darwin");
    mockState.fsReadFileSync = () => "{}";

    const { getRegisteredVaults } = await import("../../src/config-store.js");
    expect(getRegisteredVaults()).toEqual([]);
  });
});
