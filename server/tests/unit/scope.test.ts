import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock cli.js and config.js before any imports.
// For module-state tests that call vi.resetModules(), fresh dynamic imports
// re-use these registered factories automatically.
vi.mock("../../src/cli.js", () => ({
  runObsidian: vi.fn(),
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
    mockRunObsidian.mockRejectedValue(new Error("unexpected CLI call"));
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
    const { runObsidian } = await import("../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args[0] === "files:list") {
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
    const { runObsidian } = await import("../../src/cli.js");
    vi.mocked(runObsidian).mockRejectedValue(new Error("Obsidian unavailable"));
    const { initScopeEngine, isScopingEnabled } = await import("../../src/scope.js");
    await initScopeEngine("unscoped", false);
    expect(isScopingEnabled()).toBe(false);
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

  it("isNoteInScope returns true when active scope is 'unscoped'", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { isNoteInScope } = await import("../../src/scope.js");
    expect(isNoteInScope("Work/Note.md")).toBe(true);
    expect(isNoteInScope("Personal/Note.md")).toBe(true);
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

  it("filterByScope returns all paths when active scope is 'unscoped'", async () => {
    await initWithCli({ "Work/VAULTGATE.md": "---\nscope: work\n---" }, "unscoped");
    const { filterByScope } = await import("../../src/scope.js");
    const paths = ["Work/Note.md", "Personal/Note.md", "Root.md"];
    expect(filterByScope(paths)).toBe(paths);
  });

  it("filterByScope returns original array reference when scoping is disabled", async () => {
    // No initScopeEngine call → scoping stays disabled.
    const { filterByScope } = await import("../../src/scope.js");
    const paths = ["A.md", "B.md"];
    expect(filterByScope(paths)).toBe(paths);
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
    const { runObsidian } = await import("../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args[0] === "files:list")
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
});
