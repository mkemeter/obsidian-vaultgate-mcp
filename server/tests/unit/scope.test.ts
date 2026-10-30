import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";

// Mock the entire node:fs module so tests run without a real filesystem.
vi.mock("node:fs");

const mockFs = vi.mocked(fs);

// We also need to mock config.ts for normalizeContextFileName so scope.ts can import it.
vi.mock("../../src/config.js", () => ({
  normalizeContextFileName: (raw: string | undefined) => {
    if (!raw) return "VAULTGATE.md";
    if (raw.includes("/") || raw.includes("\\") || raw.includes("..")) {
      throw new Error(`Invalid conventions value "${raw}"`);
    }
    if (!raw.toLowerCase().endsWith(".md")) {
      throw new Error(`Invalid conventions value "${raw}"`);
    }
    return raw;
  },
  config: {
    vault: undefined,
    cliBin: "obsidian",
    port: 3001,
    host: "127.0.0.1",
    contextFileName: "VAULTGATE.md",
    injectConventions: true,
    injectIntervalSecs: 30,
    vaultPath: undefined,
    homeScope: "unscoped",
    scopeSwitchingEnabled: false,
    dailyNotesPath: undefined,
  },
  setVault: vi.fn(),
  setInjectionConfig: vi.fn(),
}));

describe("normalizePath", () => {
  it("returns empty string for vault root representations", async () => {
    const { normalizePath } = await import("../../src/scope.js");
    expect(normalizePath("")).toBe("");
    expect(normalizePath("/")).toBe("");
    expect(normalizePath("  ")).toBe("");
  });

  it("strips leading slashes and trims whitespace", async () => {
    const { normalizePath } = await import("../../src/scope.js");
    expect(normalizePath("/Folder/Note.md")).toBe("Folder/Note.md");
    expect(normalizePath("  Folder/Note.md  ")).toBe("Folder/Note.md");
  });

  it("converts backslashes to forward slashes", async () => {
    const { normalizePath } = await import("../../src/scope.js");
    expect(normalizePath("Folder\\Sub\\Note.md")).toBe("Folder/Sub/Note.md");
    expect(normalizePath("\\Folder\\Note.md")).toBe("Folder/Note.md");
  });
});

describe("isVaultGateFile", () => {
  it("recognises .vaultgate at vault root", async () => {
    const { isVaultGateFile } = await import("../../src/scope.js");
    expect(isVaultGateFile(".vaultgate")).toBe(true);
    expect(isVaultGateFile("/.vaultgate")).toBe(true);
  });

  it("recognises .vaultgate in subdirectories", async () => {
    const { isVaultGateFile } = await import("../../src/scope.js");
    expect(isVaultGateFile("Folder/.vaultgate")).toBe(true);
    expect(isVaultGateFile("a/b/c/.vaultgate")).toBe(true);
  });

  it("does not match .vaultgate-prefixed names", async () => {
    const { isVaultGateFile } = await import("../../src/scope.js");
    expect(isVaultGateFile(".vaultgate.bak")).toBe(false);
    expect(isVaultGateFile("Folder/.vaultgaterc")).toBe(false);
  });

  it("does not match regular note files", async () => {
    const { isVaultGateFile } = await import("../../src/scope.js");
    expect(isVaultGateFile("Notes.md")).toBe(false);
    expect(isVaultGateFile("Folder/Note.md")).toBe(false);
  });
});

describe("parseVaultGateFile", () => {
  it("parses scope key", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile('scope = "business"', "/vault/.vaultgate");
    expect(result.scope).toBe("business");
  });

  it("parses both scope and conventions keys", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      'scope = "work"\nconventions = "VAULTGATE-work.md"',
      "/vault/.vaultgate"
    );
    expect(result.scope).toBe("work");
    expect(result.conventions).toBe("VAULTGATE-work.md");
  });

  it("ignores comment lines", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      '# This is a comment\nscope = "ai"',
      "/vault/.vaultgate"
    );
    expect(result.scope).toBe("ai");
  });

  it("ignores blank lines", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      '\n\nscope = "ai"\n\n',
      "/vault/.vaultgate"
    );
    expect(result.scope).toBe("ai");
  });

  it("ignores unknown keys", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      'scope = "ai"\nunknown = "value"',
      "/vault/.vaultgate"
    );
    expect(result.scope).toBe("ai");
    expect(Object.keys(result)).not.toContain("unknown");
  });

  it("treats empty scope value as absent", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile('scope = ""', "/vault/.vaultgate");
    expect(result.scope).toBeUndefined();
  });

  it("treats whitespace-only scope value as absent", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile('scope = "   "', "/vault/.vaultgate");
    expect(result.scope).toBeUndefined();
  });

  it("discards scope names exceeding 64 characters", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const long = "a".repeat(65);
    const result = parseVaultGateFile(`scope = "${long}"`, "/vault/.vaultgate");
    expect(result.scope).toBeUndefined();
  });

  it("accepts scope names exactly 64 characters long", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const at64 = "a".repeat(64);
    const result = parseVaultGateFile(`scope = "${at64}"`, "/vault/.vaultgate");
    expect(result.scope).toBe(at64);
  });

  it("discards invalid conventions values (with path separator)", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      'scope = "ai"\nconventions = "sub/VAULTGATE.md"',
      "/vault/AI/.vaultgate"
    );
    expect(result.conventions).toBeUndefined();
  });

  it("discards conventions values not ending in .md", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile(
      'conventions = "instructions.txt"',
      "/vault/.vaultgate"
    );
    expect(result.conventions).toBeUndefined();
  });

  it("parses without quoted value when line is malformed", async () => {
    const { parseVaultGateFile } = await import("../../src/scope.js");
    const result = parseVaultGateFile("scope = business", "/vault/.vaultgate");
    expect(result.scope).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildScopeMap / initScopeEngine / resolveNoteScope / related
//
// These require module state resets between tests — use vi.resetModules().
// ---------------------------------------------------------------------------

describe("buildScopeMap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  function setupVaultWithFiles(files: Record<string, string | null>) {
    // files: keys are absolute paths; values are content strings or null (dir)
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const str = p.toString();
      return Object.keys(files).some((f) => f === str || str.startsWith(f.replace("/.vaultgate", "")));
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      const str = p.toString();
      return { isDirectory: () => !str.endsWith(".vaultgate") } as fs.Stats;
    });
    mockFs.readFileSync.mockImplementation((p: fs.PathLike | number) => {
      const str = p.toString();
      if (Object.prototype.hasOwnProperty.call(files, str) && files[str] !== null) {
        return files[str] as string;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => [] as unknown as fs.Dirent[]);
  }

  it("returns empty map when vault has no .vaultgate files", async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([] as unknown as fs.Dirent[]);
    const { buildScopeMap } = await import("../../src/scope.js");
    const map = buildScopeMap("/vault");
    expect(map.size).toBe(0);
  });

  it("silently skips subdirectories when readdirSync fails for them", async () => {
    // walkDir catch block: readdirSync fails for a child directory — should not throw.
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => p.toString() === "/vault");
    mockFs.statSync.mockImplementation((p: fs.PathLike) => ({
      isDirectory: () => p.toString() === "/vault",
    })) as unknown as typeof fs.statSync;
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      if (p.toString() === "/vault") {
        return [{ name: "BadDir", isDirectory: () => true }] as unknown as fs.Dirent[];
      }
      throw new Error("Permission denied");
    });
    const { buildScopeMap } = await import("../../src/scope.js");
    const map = buildScopeMap("/vault");
    expect(map.size).toBe(0);
  });

  it("parses a single .vaultgate at vault root", async () => {
    mockFs.existsSync.mockImplementation((p: fs.PathLike) =>
      p.toString().endsWith(".vaultgate")
    );
    mockFs.readFileSync.mockReturnValue('scope = "ai"');
    mockFs.readdirSync.mockReturnValue([] as unknown as fs.Dirent[]);
    const { buildScopeMap } = await import("../../src/scope.js");
    const map = buildScopeMap("/vault");
    expect(map.get("")).toEqual({ scope: "ai" });
  });
});

describe("resolveNoteScope + isNoteInScope + filterByScope + discoverScopes + getScopeConventionsFile + state", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  async function initWithMap(
    vaultGateFiles: Record<string, string>,
    scope = "unscoped"
  ) {
    // Build a fake vault directory at /vault with .vaultgate files at given
    // vault-relative paths (e.g. "AI Space/.vaultgate" → content string).
    const absoluteFiles: Record<string, string> = {};
    for (const [rel, content] of Object.entries(vaultGateFiles)) {
      absoluteFiles[`/vault/${rel}`] = content;
    }

    mockFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const str = p.toString();
      if (str === "/vault") return true;
      return Object.prototype.hasOwnProperty.call(absoluteFiles, str);
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => ({
      isDirectory: () => p.toString() === "/vault",
    })) as unknown as typeof fs.statSync;
    mockFs.readFileSync.mockImplementation((p: fs.PathLike | number) => {
      const str = p.toString();
      if (Object.prototype.hasOwnProperty.call(absoluteFiles, str)) return absoluteFiles[str];
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    // Provide a readdirSync that emits subdirectory entries based on vaultGateFiles keys.
    const subdirs = new Set<string>();
    for (const rel of Object.keys(vaultGateFiles)) {
      const parts = rel.split("/");
      if (parts.length > 1) {
        // e.g. "AI Space/.vaultgate" → subdirectory "AI Space"
        subdirs.add(parts[0]);
      }
    }
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      if (p.toString() === "/vault") {
        return [...subdirs].map((name) => ({
          name,
          isDirectory: () => true,
        })) as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    const { initScopeEngine } = await import("../../src/scope.js");
    initScopeEngine("/vault", scope, false);
  }

  it("returns 'unscoped' for notes with no .vaultgate ancestor", async () => {
    await initWithMap({});
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Notes/Idea.md")).toBe("unscoped");
    expect(resolveNoteScope("Root.md")).toBe("unscoped");
  });

  it("resolves scope from the nearest ancestor .vaultgate", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("AI Space/Note.md")).toBe("ai");
    expect(resolveNoteScope("AI Space/Sub/Note.md")).toBe("ai");
  });

  it("inherits scope through multiple levels of nesting", async () => {
    await initWithMap({ "Work/.vaultgate": 'scope = "work"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Work/Projects/2026/Report.md")).toBe("work");
  });

  it("falls through to unscoped for notes outside any .vaultgate directory", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Private/Note.md")).toBe("unscoped");
    expect(resolveNoteScope("Root.md")).toBe("unscoped");
  });

  it("resolves scope for a non-existent note via its parent directory", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    // Note does not exist yet; parent dir is "AI Space" → scope "ai".
    expect(resolveNoteScope("AI Space/New Note.md")).toBe("ai");
  });

  it("normalises paths with leading slash before resolving", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("/AI Space/Note.md")).toBe("ai");
  });

  it("normalises backslash paths before resolving", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("AI Space\\Note.md")).toBe("ai");
  });

  it("isNoteInScope returns true when note matches active scope", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("AI Space/Note.md")).toBe(true);
  });

  it("isNoteInScope returns false when note is in a different scope", async () => {
    await initWithMap(
      {
        "AI Space/.vaultgate": 'scope = "ai"',
        "Private/.vaultgate": 'scope = "private"',
      },
      "ai"
    );
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("Private/Note.md")).toBe(false);
    expect(isNoteInScope("Root.md")).toBe(false); // unscoped, not "ai"
  });

  it("filterByScope keeps only in-scope paths", async () => {
    await initWithMap(
      {
        "AI Space/.vaultgate": 'scope = "ai"',
        "Private/.vaultgate": 'scope = "private"',
      },
      "ai"
    );
    const { filterByScope } = await import("../../src/scope.js");
    const filtered = filterByScope([
      "AI Space/Note.md",
      "Private/Secret.md",
      "Root.md",
    ]);
    expect(filtered).toEqual(["AI Space/Note.md"]);
  });

  it("filterByScope returns empty array when no paths match", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { filterByScope } = await import("../../src/scope.js");
    expect(filterByScope(["Root.md", "Other/Note.md"])).toEqual([]);
  });

  it("filterByScope returns the original array when scoping is disabled", async () => {
    vi.resetModules();
    vi.resetAllMocks();
    // Do NOT call initScopeEngine → scoping stays disabled.
    const { filterByScope } = await import("../../src/scope.js");
    const paths = ["A.md", "B.md"];
    expect(filterByScope(paths)).toBe(paths);
  });

  it("discoverScopes always includes 'unscoped'", async () => {
    await initWithMap({});
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toContain("unscoped");
  });

  it("discoverScopes returns all declared scopes plus 'unscoped'", async () => {
    await initWithMap({
      "AI Space/.vaultgate": 'scope = "ai"',
      "Private/.vaultgate": 'scope = "private"',
    });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toEqual(["ai", "private", "unscoped"]);
  });

  it("discoverScopes deduplicates scopes shared across multiple dirs", async () => {
    // Use flat structure — the initWithMap helper only mocks one level of subdirs.
    await initWithMap({
      "DirA/.vaultgate": 'scope = "work"',
      "DirB/.vaultgate": 'scope = "work"',
    });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes().filter((s) => s === "work")).toHaveLength(1);
  });

  it("getScopeConventionsFile returns undefined when active scope is 'unscoped'", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"\nconventions = "VAULTGATE-ai.md"' });
    // active scope is "unscoped" (default)
    const { getScopeConventionsFile } = await import("../../src/scope.js");
    expect(getScopeConventionsFile()).toBeUndefined();
  });

  it("getScopeConventionsFile returns conventions filename for the active scope", async () => {
    await initWithMap(
      { "AI Space/.vaultgate": 'scope = "ai"\nconventions = "VAULTGATE-ai.md"' },
      "ai"
    );
    const { getScopeConventionsFile } = await import("../../src/scope.js");
    expect(getScopeConventionsFile()).toBe("VAULTGATE-ai.md");
  });

  it("getScopeConventionsFile returns undefined when scope has no conventions key", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { getScopeConventionsFile } = await import("../../src/scope.js");
    expect(getScopeConventionsFile()).toBeUndefined();
  });

  it("getScopeConventionsFile picks shortest-path .vaultgate when multiple dirs share a scope", async () => {
    await initWithMap(
      {
        "Work/.vaultgate": 'scope = "work"\nconventions = "VAULTGATE-work-root.md"',
        "Work/Sub/.vaultgate": 'scope = "work"\nconventions = "VAULTGATE-work-sub.md"',
      },
      "work"
    );
    const { getScopeConventionsFile } = await import("../../src/scope.js");
    // "Work" is shorter than "Work/Sub" → root wins
    expect(getScopeConventionsFile()).toBe("VAULTGATE-work-root.md");
  });

  it("setActiveScope and getActiveScope update module state", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "unscoped");
    const { setActiveScope, getActiveScope } = await import("../../src/scope.js");
    setActiveScope("ai");
    expect(getActiveScope()).toBe("ai");
  });

  it("resetToHomeScope restores the configured home scope", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { setActiveScope, resetToHomeScope, getActiveScope } = await import("../../src/scope.js");
    setActiveScope("unscoped");
    expect(getActiveScope()).toBe("unscoped");
    resetToHomeScope();
    expect(getActiveScope()).toBe("ai");
  });

  it("isScopingEnabled returns false before initScopeEngine is called", async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
  });

  it("isScopingEnabled returns true after successful initScopeEngine", async () => {
    await initWithMap({});
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(true);
  });

  it("initScopeEngine stays disabled when vault path does not exist", async () => {
    vi.resetModules();
    vi.resetAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    const { initScopeEngine, isScopingEnabled } = await import("../../src/scope.js");
    initScopeEngine("/nonexistent", "ai", false);
    expect(isScopingEnabled()).toBe(false);
  });

  it("isScopeSwitchingEnabled reflects the switching parameter", async () => {
    vi.resetModules();
    vi.resetAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
    mockFs.readdirSync.mockReturnValue([] as unknown as fs.Dirent[]);
    const { initScopeEngine, isScopeSwitchingEnabled } = await import("../../src/scope.js");
    initScopeEngine("/vault", "unscoped", true);
    expect(isScopeSwitchingEnabled()).toBe(true);
  });

  it("rebuildScopeMap is a no-op when scoping is disabled", async () => {
    vi.resetModules();
    vi.resetAllMocks();
    // Do not call initScopeEngine — scoping stays disabled.
    const { isScopingEnabled, rebuildScopeMap } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
    rebuildScopeMap(); // must not throw and must not change enabled state
    expect(isScopingEnabled()).toBe(false);
  });

  it("getHomeScope returns the initial scope configured at startup", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { getHomeScope } = await import("../../src/scope.js");
    expect(getHomeScope()).toBe("ai");
  });

  it("updateVaultPath with undefined disables scoping", async () => {
    await initWithMap({});
    const { isScopingEnabled, updateVaultPath } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(true);
    updateVaultPath(undefined);
    expect(isScopingEnabled()).toBe(false);
  });

  it("updateVaultPath with non-existent path warns and keeps existing state", async () => {
    await initWithMap({ "AI Space/.vaultgate": 'scope = "ai"' }, "ai");
    const { isScopingEnabled, updateVaultPath } = await import("../../src/scope.js");
    // Make the new path fail the existence check
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => p.toString() === "/vault");
    mockFs.statSync.mockImplementation((p: fs.PathLike) => ({
      isDirectory: () => p.toString() === "/vault",
    })) as unknown as typeof fs.statSync;
    updateVaultPath("/nonexistent-new-path");
    // Scoping should still be enabled with the original vault
    expect(isScopingEnabled()).toBe(true);
  });

  it("updateVaultPath with valid path rebuilds the scope map and resets to home scope", async () => {
    await initWithMap({ "Old Space/.vaultgate": 'scope = "old"' }, "old");
    const { setActiveScope, getActiveScope, updateVaultPath, isScopingEnabled } =
      await import("../../src/scope.js");
    // Switch to a different scope before the vault path update
    setActiveScope("unscoped");
    expect(getActiveScope()).toBe("unscoped");

    // Set up the new vault path with its own .vaultgate
    mockFs.existsSync.mockImplementation((p: fs.PathLike) => p.toString() === "/new-vault");
    mockFs.statSync.mockImplementation((p: fs.PathLike) => ({
      isDirectory: () => p.toString() === "/new-vault",
    })) as unknown as typeof fs.statSync;
    mockFs.readdirSync.mockReturnValue([] as unknown as fs.Dirent[]);

    updateVaultPath("/new-vault");
    // Active scope should be reset to home scope ("old")
    expect(getActiveScope()).toBe("old");
    expect(isScopingEnabled()).toBe(true);
  });
});
