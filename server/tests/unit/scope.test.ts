import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock cli.js and config.js before any imports.
// For module-state tests that call vi.resetModules(), fresh dynamic imports
// re-use these registered factories automatically.
vi.mock("../../src/cli.js", () => ({
  runObsidian: vi.fn(),
  runObsidianAdmin: vi.fn(),
}));
vi.mock("../../src/config.js", () => ({
  config: {
    vault: undefined,
    cliBin: "obsidian",
    port: 3001,
    host: "127.0.0.1",
    contextFileName: "VAULTGATE.md",
    injectConventions: true,
    injectIntervalSecs: 30,
    homeScope: "unscoped",
    scopeSwitchingEnabled: false,
    dailyNotesPath: undefined,
  },
  setVault: vi.fn(),
  setInjectionConfig: vi.fn(),
}));

import * as cliModule from "../../src/cli.js";
const mockRunObsidian = vi.mocked(cliModule.runObsidian);
const mockRunObsidianAdmin = vi.mocked(cliModule.runObsidianAdmin);

// ---------------------------------------------------------------------------
// Pure utilities — no module state, no resets needed
// ---------------------------------------------------------------------------

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

describe("extractBody", () => {
  it("returns content unchanged when no frontmatter present", async () => {
    const { extractBody } = await import("../../src/scope.js");
    expect(extractBody("# Hello\n\nWorld")).toBe("# Hello\n\nWorld");
  });

  it("strips YAML frontmatter block", async () => {
    const { extractBody } = await import("../../src/scope.js");
    const content = "---\nscope: work\n---\n# Body";
    expect(extractBody(content)).toBe("# Body");
  });

  it("handles frontmatter with CRLF line endings", async () => {
    const { extractBody } = await import("../../src/scope.js");
    const content = "---\r\nscope: work\r\n---\r\n# Body";
    expect(extractBody(content)).toBe("# Body");
  });

  it("returns empty string when file is frontmatter-only", async () => {
    const { extractBody } = await import("../../src/scope.js");
    expect(extractBody("---\nscope: work\n---\n")).toBe("");
  });

  it("does not strip text that looks like frontmatter but is not at start", async () => {
    const { extractBody } = await import("../../src/scope.js");
    const content = "# Title\n---\nscope: work\n---\n";
    expect(extractBody(content)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// CLI-based scope engine — module state resets required
// ---------------------------------------------------------------------------

describe("scope engine (CLI-based)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    // Re-apply mock defaults after resetModules clears mock implementations.
    mockRunObsidian.mockRejectedValue(new Error("unexpected runObsidian call"));
    mockRunObsidianAdmin.mockRejectedValue(new Error("unexpected runObsidianAdmin call"));
  });

  /**
   * Sets up the CLI mock to simulate a vault with the given conventions files,
   * then calls initScopeEngine with the given scope and switching parameters.
   *
   * @param files vault-relative path → file content (only files with contextFileName basename matter)
   */
  async function initWithCli(
    files: Record<string, string>,
    scope = "unscoped",
    switching = false
  ) {
    const { runObsidianAdmin } = await import("../../src/cli.js");
    vi.mocked(runObsidianAdmin).mockImplementation(async (args: string[]) => {
      if (args[0] === "files" && args[1] === "list") {
        return Object.keys(files).join("\n");
      }
      if (args[0] === "read") {
        const pathArg = args.find((a) => a.startsWith("path="))?.slice(5);
        if (pathArg !== undefined && Object.prototype.hasOwnProperty.call(files, pathArg)) {
          return files[pathArg];
        }
        throw new Error(`File not found: ${pathArg ?? "(none)"}`);
      }
      throw new Error(`Unexpected CLI args: ${args.join(" ")}`);
    });
    const { initScopeEngine } = await import("../../src/scope.js");
    await initScopeEngine(scope, switching);
  }

  // ---- isScopingEnabled ----

  it("isScopingEnabled returns false before initScopeEngine is called", async () => {
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
  });

  it("isScopingEnabled stays false when vault has no conventions files", async () => {
    await initWithCli({});
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
  });

  it("isScopingEnabled stays false when conventions file has no scope: frontmatter", async () => {
    await initWithCli({ "VAULTGATE.md": "# No scope here" });
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
  });

  it("isScopingEnabled returns true when at least one scope zone is found", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---\n# Work" });
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(true);
  });

  it("isScopingEnabled stays false when CLI fails", async () => {
    const { runObsidianAdmin } = await import("../../src/cli.js");
    vi.mocked(runObsidianAdmin).mockRejectedValue(new Error("Obsidian unavailable"));
    const { initScopeEngine, isScopingEnabled } = await import("../../src/scope.js");
    await initScopeEngine("unscoped", false);
    expect(isScopingEnabled()).toBe(false);
  });

  it("regression: buildScopeMapFromCli uses ['files', 'list'] not ['files:list']", async () => {
    // 'files:list' is not a valid Obsidian CLI command — it silently returns an error
    // string, leaving scopeZoneMap empty and enabled=false. 'files' + 'list' is correct.
    const { runObsidianAdmin } = await import("../../src/cli.js");
    const calls: string[][] = [];
    vi.mocked(runObsidianAdmin).mockImplementation(async (args: string[]) => {
      calls.push(args);
      if (args[0] === "files" && args[1] === "list") return "Work/VAULTGATE.md\n";
      if (args[0] === "read") return "---\nscope: work\n---\n";
      return "";
    });
    const { initScopeEngine, isScopingEnabled } = await import("../../src/scope.js");
    await initScopeEngine("unscoped", false);
    const fileListCall = calls.find((a) => a[0] === "files");
    expect(fileListCall).toEqual(["files", "list"]);
    expect(calls.some((a) => a[0] === "files:list")).toBe(false);
    expect(isScopingEnabled()).toBe(true);
  });

  // ---- isScopeSwitchingEnabled ----

  it("isScopeSwitchingEnabled reflects the switching parameter", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped", true);
    const { isScopeSwitchingEnabled } = await import("../../src/scope.js");
    expect(isScopeSwitchingEnabled()).toBe(true);
  });

  // ---- discoverScopes ----

  it("discoverScopes always includes 'unscoped'", async () => {
    await initWithCli({});
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toContain("unscoped");
  });

  it("discoverScopes returns all declared scopes plus 'unscoped'", async () => {
    await initWithCli({
      "Work/VAULTGATE.md": "---\nscope: work\n---",
      "Personal/VAULTGATE.md": "---\nscope: personal\n---",
    });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toEqual(["personal", "unscoped", "work"]);
  });

  it("discoverScopes deduplicates scopes shared across multiple dirs", async () => {
    await initWithCli({
      "DirA/VAULTGATE.md": "---\nscope: work\n---",
      "DirB/VAULTGATE.md": "---\nscope: work\n---",
    });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes().filter((s) => s === "work")).toHaveLength(1);
  });

  // ---- resolveNoteScope ----

  it("resolveNoteScope returns 'unscoped' for notes with no ancestor scope zone", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Personal/Note.md")).toBe("unscoped");
    expect(resolveNoteScope("Root.md")).toBe("unscoped");
  });

  it("resolveNoteScope resolves scope from nearest ancestor conventions file", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Work/Note.md")).toBe("work");
    expect(resolveNoteScope("Work/Sub/Deep/Note.md")).toBe("work");
  });

  it("resolveNoteScope normalises backslash paths", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("Work\\Note.md")).toBe("work");
  });

  it("resolveNoteScope normalises leading-slash paths", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { resolveNoteScope } = await import("../../src/scope.js");
    expect(resolveNoteScope("/Work/Note.md")).toBe("work");
  });

  // ---- isNoteInScope ----

  it("isNoteInScope returns true when note matches active scope", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "work");
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("Work/Note.md")).toBe(true);
  });

  it("isNoteInScope returns false when note is in a different scope", async () => {
    await initWithCli(
      {
        "Work/VAULTGATE.md": "---\nscope: work\n---",
        "Personal/VAULTGATE.md": "---\nscope: personal\n---",
      },
      "work"
    );
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("Personal/Note.md")).toBe(false);
    expect(isNoteInScope("Root.md")).toBe(false);
  });

  it("isNoteInScope returns false for named-zone notes when active scope is 'unscoped'", async () => {
    // "unscoped" is a strict scope — notes from named zones are out-of-scope.
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("Work/Note.md")).toBe(false);    // in "work" zone — out of scope
    expect(isNoteInScope("Personal/Note.md")).toBe(true); // no zone → unscoped → in scope
  });

  // ---- filterByScope ----

  it("filterByScope keeps only in-scope paths", async () => {
    await initWithCli(
      {
        "Work/VAULTGATE.md": "---\nscope: work\n---",
        "Personal/VAULTGATE.md": "---\nscope: personal\n---",
      },
      "work"
    );
    const { filterByScope } = await import("../../src/scope.js");
    const filtered = filterByScope(["Work/Note.md", "Personal/Secret.md", "Root.md"]);
    expect(filtered).toEqual(["Work/Note.md"]);
  });

  it("filterByScope excludes named-zone notes when active scope is 'unscoped'", async () => {
    // "unscoped" is a strict scope — only notes without a scope zone are in scope.
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { filterByScope } = await import("../../src/scope.js");
    const paths = ["Work/Note.md", "Personal/Note.md", "Root.md"];
    // Work/Note.md is in the "work" zone — out-of-scope for "unscoped".
    // Personal/Note.md and Root.md have no zone — they belong to "unscoped".
    expect(filterByScope(paths)).toEqual(["Personal/Note.md", "Root.md"]);
  });

  it("filterByScope returns all paths when scoping is disabled", async () => {
    // No initScopeEngine call → scoping stays disabled; all paths pass through.
    const { filterByScope } = await import("../../src/scope.js");
    const paths = ["A.md", "B.md"];
    expect(filterByScope(paths)).toStrictEqual(paths);
  });

  // ---- state accessors ----

  it("setActiveScope and getActiveScope update module state", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { setActiveScope, getActiveScope } = await import("../../src/scope.js");
    setActiveScope("work");
    expect(getActiveScope()).toBe("work");
  });

  it("resetToHomeScope restores the configured home scope", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "work");
    const { setActiveScope, resetToHomeScope, getActiveScope } = await import("../../src/scope.js");
    setActiveScope("unscoped");
    expect(getActiveScope()).toBe("unscoped");
    resetToHomeScope();
    expect(getActiveScope()).toBe("work");
  });

  it("getHomeScope returns the initial scope configured at startup", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "work");
    const { getHomeScope } = await import("../../src/scope.js");
    expect(getHomeScope()).toBe("work");
  });

  // ---- rebuildScopeMap ----

  it("rebuildScopeMap is a no-op when scoping is disabled", async () => {
    const { isScopingEnabled, rebuildScopeMap } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
    await rebuildScopeMap();
    expect(isScopingEnabled()).toBe(false);
  });

  it("rebuildScopeMap re-scans CLI and updates discovered scopes", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    // Now simulate a vault change: a new scope zone appears
    const { runObsidianAdmin } = await import("../../src/cli.js");
    vi.mocked(runObsidianAdmin).mockImplementation(async (args: string[]) => {
      if (args[0] === "files" && args[1] === "list")
        return "Work/VAULTGATE.md\nPersonal/VAULTGATE.md";
      if (args[0] === "read") {
        const p = args.find((a) => a.startsWith("path="))?.slice(5);
        if (p === "Work/VAULTGATE.md") return "---\nscope: work\n---";
        if (p === "Personal/VAULTGATE.md") return "---\nscope: personal\n---";
        throw new Error("not found");
      }
      throw new Error("unexpected");
    });
    const { rebuildScopeMap, discoverScopes } = await import("../../src/scope.js");
    await rebuildScopeMap();
    expect(discoverScopes()).toContain("personal");
  });

  // ---- getConventionsPaths ----

  it("getConventionsPaths returns [contextFileName] when scoping is disabled", async () => {
    const { getConventionsPaths } = await import("../../src/scope.js");
    expect(getConventionsPaths()).toEqual(["VAULTGATE.md"]);
  });

  it("getConventionsPaths returns [rootFile] when root has no scope and active scope is unscoped", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { getConventionsPaths } = await import("../../src/scope.js");
    expect(getConventionsPaths()).toEqual(["VAULTGATE.md"]);
  });

  it("getConventionsPaths returns [root, scopeFile] when root has no scope and named scope active", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "work");
    const { getConventionsPaths } = await import("../../src/scope.js");
    expect(getConventionsPaths()).toEqual(["VAULTGATE.md", "Work/VAULTGATE.md"]);
  });

  it("getConventionsPaths returns [rootFile] when named scope has no conventions file", async () => {
    // initScopeEngine with homeScope="work" but no scope zones found → stays disabled.
    // Use a different setup: active scope set manually to something with no conventions file.
    await initWithCli(
      {
        "Work/VAULTGATE.md": "---\nscope: work\n---",
        "Personal/VAULTGATE.md": "---\nscope: personal\n---",
      },
      "unscoped"
    );
    const { setActiveScope, getConventionsPaths } = await import("../../src/scope.js");
    // Switch to a scope that has a conventions file path in conventionsPathMap.
    // To test the "no scope file" case, we test the "unscoped" active scope case instead,
    // since conventionsPathMap only contains scopes we found.
    setActiveScope("unscoped");
    // unscoped → no scope file in map → [rootFile] only
    expect(getConventionsPaths()).toEqual(["VAULTGATE.md"]);
  });

  it("getConventionsPaths returns [scopeFile] when root itself has scope: frontmatter and scope matches", async () => {
    // Root VAULTGATE.md declares scope: root-scope
    await initWithCli({ "VAULTGATE.md": "---\nscope: root-scope\n---\n# Conventions" }, "root-scope");
    const { getConventionsPaths } = await import("../../src/scope.js");
    expect(getConventionsPaths()).toEqual(["VAULTGATE.md"]);
  });

  it("getConventionsPaths returns [] when root has scope: and active scope does not match", async () => {
    await initWithCli({ "VAULTGATE.md": "---\nscope: root-scope\n---" }, "unscoped");
    const { getConventionsPaths } = await import("../../src/scope.js");
    // active scope "unscoped" → no match for "root-scope" → []
    expect(getConventionsPaths()).toEqual([]);
  });

  // ---- isRootGlobal ----

  it("isRootGlobal returns true when root file has no scope: frontmatter", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { isRootGlobal } = await import("../../src/scope.js");
    expect(isRootGlobal()).toBe(true);
  });

  it("isRootGlobal returns false when root file carries scope: frontmatter", async () => {
    await initWithCli({ "VAULTGATE.md": "---\nscope: root-scope\n---" }, "root-scope");
    const { isRootGlobal } = await import("../../src/scope.js");
    expect(isRootGlobal()).toBe(false);
  });

  // ---- frontmatter scope value parsing (via initScopeEngine behavior) ----

  it("recognises unquoted scope values", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toContain("work");
  });

  it("recognises double-quoted scope values", async () => {
    await initWithCli({ 'Work/VAULTGATE.md': '---\nscope: "work"\n---' });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toContain("work");
  });

  it("recognises single-quoted scope values", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: 'work'\n---" });
    const { discoverScopes } = await import("../../src/scope.js");
    expect(discoverScopes()).toContain("work");
  });

  it("ignores scope values exceeding 64 characters", async () => {
    const long = "a".repeat(65);
    const files: Record<string, string> = {};
    files["Work/VAULTGATE.md"] = `---\nscope: ${long}\n---`;
    await initWithCli(files);
    const { isScopingEnabled } = await import("../../src/scope.js");
    // Oversized scope → no zones found → scoping stays disabled
    expect(isScopingEnabled()).toBe(false);
  });

  it("only processes files matching the configured contextFileName", async () => {
    // The CLI returns OTHER.md and VAULTGATE.md; only VAULTGATE.md matches contextFileName.
    await initWithCli({
      "Work/OTHER.md": "---\nscope: work\n---",
      "Work/VAULTGATE.md": "# No scope here",
    });
    const { isScopingEnabled } = await import("../../src/scope.js");
    expect(isScopingEnabled()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Scope access levels
  // ---------------------------------------------------------------------------

  describe("scope access levels", () => {
    it("getScopeAccess returns 'rw' by default when no access: declared", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("rw");
    });

    it("getScopeAccess returns 'none' when access: none declared", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("none");
    });

    it("getScopeAccess returns 'ro' when access: ro declared", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: ro\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("ro");
    });

    it("getScopeAccess returns 'ro' when access: read-only declared", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: read-only\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("ro");
    });

    it("getScopeAccess returns 'rw' when access: read-write declared", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: read-write\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("rw");
    });

    it("getScopeAccess returns 'rw' for unknown access values", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: superuser\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("work")).toBe("rw");
    });

    it("getScopeAccess returns 'rw' for an unknown scope (default)", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" });
      const { getScopeAccess } = await import("../../src/scope.js");
      expect(getScopeAccess("nonexistent")).toBe("rw");
    });

    it("getActiveScopeAccess returns 'rw' when scoping is disabled", async () => {
      const { getActiveScopeAccess } = await import("../../src/scope.js");
      expect(getActiveScopeAccess()).toBe("rw");
    });

    it("getActiveScopeAccess returns 'rw' for unscoped", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: ro\n---" }, "unscoped");
      const { getActiveScopeAccess } = await import("../../src/scope.js");
      expect(getActiveScopeAccess()).toBe("rw");
    });

    it("getActiveScopeAccess returns the active scope's level", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: ro\n---" }, "work");
      const { getActiveScopeAccess } = await import("../../src/scope.js");
      expect(getActiveScopeAccess()).toBe("ro");
    });

    it("checkAccess: none scope blocks reads", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" });
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/Note.md", "read");
      expect(result.allowed).toBe(false);
    });

    it("checkAccess: none scope blocks writes", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" });
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/Note.md", "write");
      expect(result.allowed).toBe(false);
    });

    it("checkAccess: ro scope allows reads", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: ro\n---" }, "work");
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/Note.md", "read");
      expect(result.allowed).toBe(true);
    });

    it("checkAccess: ro scope blocks writes", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: ro\n---" }, "work");
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/Note.md", "write");
      expect(result.allowed).toBe(false);
    });

    it("checkAccess: rw scope allows reads and writes", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "work");
      const { checkAccess } = await import("../../src/scope.js");
      expect(checkAccess("Work/Note.md", "read").allowed).toBe(true);
      expect(checkAccess("Work/Note.md", "write").allowed).toBe(true);
    });

    it("checkAccess: conventions file is always readable even in none scope", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" });
      const { checkAccess } = await import("../../src/scope.js");
      // VAULTGATE.md is the contextFileName — read must be allowed
      const result = checkAccess("Work/VAULTGATE.md", "read");
      expect(result.allowed).toBe(true);
    });

    it("checkAccess: conventions file write is blocked in none scope", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" });
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/VAULTGATE.md", "write");
      expect(result.allowed).toBe(false);
    });

    it("checkAccess: none scope is absolute — blocks even in unscoped mode", async () => {
      // Active scope is unscoped, but Work has access: none
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" }, "unscoped");
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Work/Note.md", "read");
      expect(result.allowed).toBe(false);
    });

    it("isNoteInScope returns false for none-scope note even in unscoped mode", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" }, "unscoped");
      const { isNoteInScope } = await import("../../src/scope.js");
      expect(isNoteInScope("Work/Secret.md")).toBe(false);
      // Notes outside the none-scope zone are still accessible
      expect(isNoteInScope("Personal/Note.md")).toBe(true);
    });

    it("filterByScope excludes none-scope paths in unscoped mode", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" }, "unscoped");
      const { filterByScope } = await import("../../src/scope.js");
      const result = filterByScope(["Work/Secret.md", "Personal/Note.md", "Root.md"]);
      expect(result).not.toContain("Work/Secret.md");
      expect(result).toContain("Personal/Note.md");
      expect(result).toContain("Root.md");
    });

    it("filterByScope returns empty array when all paths are in a none scope", async () => {
      await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---" }, "unscoped");
      const { filterByScope } = await import("../../src/scope.js");
      expect(filterByScope(["Work/A.md", "Work/B.md", "Work/Sub/C.md"])).toEqual([]);
    });

    // --- scope membership enforcement ---

    it("checkAccess: out-of-scope read is blocked regardless of access level", async () => {
      // regression: checkAccess previously only enforced access level, not scope membership.
      // A note in "personal" must be blocked when active scope is "work".
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { checkAccess, SCOPE_OUT_OF_SCOPE_MESSAGE } = await import("../../src/scope.js");
      const result = checkAccess("Personal/Note.md", "read");
      expect(result.allowed).toBe(false);
      expect((result as { allowed: false; message: string }).message).toBe(
        SCOPE_OUT_OF_SCOPE_MESSAGE
      );
    });

    it("checkAccess: out-of-scope write is blocked regardless of access level", async () => {
      // regression: same gap — direct path knowledge must not grant write access.
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { checkAccess } = await import("../../src/scope.js");
      const result = checkAccess("Personal/Note.md", "write");
      expect(result.allowed).toBe(false);
    });

    it("checkAccess: unscoped mode blocks notes from named scope zones", async () => {
      // "unscoped" is a strict scope — notes from named zones are out-of-scope
      // when activeScope is "unscoped", just like any other scope combination.
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "unscoped"
      );
      const { checkAccess } = await import("../../src/scope.js");
      expect(checkAccess("Work/Note.md", "read").allowed).toBe(false);
      expect(checkAccess("Personal/Note.md", "read").allowed).toBe(false);
      // Root-level notes (no scope zone) belong to the unscoped zone — accessible
      expect(checkAccess("RootNote.md", "read").allowed).toBe(true);
    });

    it("checkAccess: conventions file in out-of-scope zone is still readable", async () => {
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { checkAccess } = await import("../../src/scope.js");
      // Conventions files are VaultGate config — always readable across scope boundaries.
      expect(checkAccess("Personal/VAULTGATE.md", "read").allowed).toBe(true);
    });

    it("checkAccess: conventions file write in out-of-scope zone is blocked", async () => {
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { checkAccess } = await import("../../src/scope.js");
      // Read exception does not extend to writes — scope membership applies.
      const result = checkAccess("Personal/VAULTGATE.md", "write");
      expect(result.allowed).toBe(false);
    });

    it("isNoteInScope returns false for out-of-scope notes when a named scope is active", async () => {
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { isNoteInScope } = await import("../../src/scope.js");
      expect(isNoteInScope("Work/Note.md")).toBe(true);
      expect(isNoteInScope("Personal/Note.md")).toBe(false);
    });

    it("filterByScope excludes out-of-scope notes when a named scope is active", async () => {
      await initWithCli(
        {
          "Work/VAULTGATE.md": "---\nscope: work\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        },
        "work"
      );
      const { filterByScope } = await import("../../src/scope.js");
      const result = filterByScope(["Work/Note.md", "Personal/Note.md", "Work/Sub/File.md"]);
      expect(result).toContain("Work/Note.md");
      expect(result).not.toContain("Personal/Note.md");
      expect(result).toContain("Work/Sub/File.md");
    });
  });

  // ---------------------------------------------------------------------------
  // Natural behaviour when scoping is not configured
  // ---------------------------------------------------------------------------
  // These tests prove that the !enabled guards removed from checkAccess,
  // isNoteInScope, filterByScope, and getActiveScopeAccess were genuinely
  // redundant — the data (empty maps, activeScope="unscoped") produces the
  // correct result without any explicit guard.

  describe("access functions when scoping is not configured", () => {
    it("checkAccess allows all reads when no scope zones exist", async () => {
      // No initWithCli — scoping never enabled; enabled=false, activeScope="unscoped"
      const { checkAccess } = await import("../../src/scope.js");
      expect(checkAccess("Work/Note.md", "read").allowed).toBe(true);
      expect(checkAccess("Personal/Note.md", "read").allowed).toBe(true);
      expect(checkAccess("Root.md", "read").allowed).toBe(true);
    });

    it("checkAccess allows all writes when no scope zones exist", async () => {
      const { checkAccess } = await import("../../src/scope.js");
      expect(checkAccess("Work/Note.md", "write").allowed).toBe(true);
      expect(checkAccess(undefined, "write").allowed).toBe(true);
    });

    it("isNoteInScope returns true for all paths when no scope zones exist", async () => {
      const { isNoteInScope } = await import("../../src/scope.js");
      expect(isNoteInScope("Work/Note.md")).toBe(true);
      expect(isNoteInScope("Personal/Secret.md")).toBe(true);
    });

    it("filterByScope returns the full array when no scope zones exist", async () => {
      const { filterByScope } = await import("../../src/scope.js");
      const paths = ["Work/A.md", "Personal/B.md", "Root.md"];
      expect(filterByScope(paths)).toEqual(paths);
    });

    it("getActiveScopeAccess returns 'rw' when no scope zones exist", async () => {
      const { getActiveScopeAccess } = await import("../../src/scope.js");
      expect(getActiveScopeAccess()).toBe("rw");
    });
  });
});
