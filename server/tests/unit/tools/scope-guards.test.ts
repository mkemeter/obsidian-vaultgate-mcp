/**
 * Scope guard tests (Phase 2) — covers Pattern A, B, D enforcement across all
 * tool files modified to support vault scoping. Mocks scope.js so the guards
 * can be exercised without a real vault filesystem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mutable config object hoisted so the vi.mock factory can access it.
const mockConfig = vi.hoisted(() => ({
  vault: undefined as string | undefined,
  cliBin: "obsidian",
  port: 3001,
  host: "127.0.0.1" as const,
  dailyNotesPath: undefined as string | undefined,
  contextFileName: "VAULTGATE.md",
  injectConventions: true,
  injectIntervalSecs: 30,
}));

vi.mock("@xenova/transformers", () => ({ pipeline: vi.fn() }));
vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({ config: mockConfig }));
vi.mock("../../../src/scope.js", () => ({
  isScopingEnabled: vi.fn(() => false),
  isPathBlocked: vi.fn(() => false),
  filterByScope: vi.fn((paths: string[]) => paths),
  isVaultGateFile: vi.fn(() => false),
  isNoteInScope: vi.fn(() => true),
  getScopeConventionsFile: vi.fn(() => undefined),
  SCOPE_BLOCKED_MESSAGE: "This note is not accessible in the current scope.",
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

const scopeModule = await import("../../../src/scope.js");
const mockIsScopingEnabled = vi.mocked(scopeModule.isScopingEnabled);
const mockIsPathBlocked = vi.mocked(scopeModule.isPathBlocked);
const mockFilterByScope = vi.mocked(scopeModule.filterByScope);
const mockIsVaultGateFile = vi.mocked(scopeModule.isVaultGateFile);
const mockIsNoteInScope = vi.mocked(scopeModule.isNoteInScope);
const mockGetScopeConventionsFile = vi.mocked(scopeModule.getScopeConventionsFile);

const BLOCKED_MSG = "This note is not accessible in the current scope.";

function invoke(server: McpServer, name: string, args: Record<string, unknown>) {
  // @ts-ignore
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // Restore safe defaults — resetAllMocks clears all implementations.
  mockIsScopingEnabled.mockReturnValue(false);
  mockIsPathBlocked.mockReturnValue(false);
  mockFilterByScope.mockImplementation((paths: string[]) => paths);
  mockIsVaultGateFile.mockReturnValue(false);
  mockIsNoteInScope.mockReturnValue(true);
  mockGetScopeConventionsFile.mockReturnValue(undefined);
  mockRun.mockResolvedValue("");
  mockConfig.dailyNotesPath = undefined;
});

// ---------------------------------------------------------------------------
// FILES scope guards
// ---------------------------------------------------------------------------

describe("files_list scope filtering (Pattern B)", () => {
  it("strips .vaultgate entries from output even when scoping is disabled", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockRun.mockResolvedValue("note.md\n.vaultgate\nfolder/.vaultgate\nother.md");
    mockIsVaultGateFile.mockImplementation((p: string) =>
      p === ".vaultgate" || p.endsWith("/.vaultgate")
    );
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "files_list", {});
    expect(result.content[0].text).not.toContain(".vaultgate");
    expect(result.content[0].text).toContain("note.md");
    expect(result.content[0].text).toContain("other.md");
  });

  it("filters out-of-scope paths when scoping is enabled", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockRun.mockResolvedValue("ai/note1.md\nprivate/secret.md\nai/note2.md");
    mockFilterByScope.mockImplementation((paths: string[]) =>
      paths.filter((p) => p.startsWith("ai/"))
    );
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "files_list", {});
    expect(result.content[0].text).toContain("ai/note1.md");
    expect(result.content[0].text).not.toContain("private/secret.md");
  });

  it("returns empty string (not error) when all paths filtered", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockRun.mockResolvedValue("private/note.md");
    mockFilterByScope.mockReturnValue([]);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "files_list", {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("");
  });
});

describe("files_read scope guard (Pattern A)", () => {
  it("returns scope-blocked error when path is blocked", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "files_read", { path: "private/secret.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("note_create scope guard (Pattern A)", () => {
  it("blocks when the target path is in a different scope", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "note_create", {
      path: "private/new.md",
      content: "hello",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("note_append scope guard (Pattern A)", () => {
  it("blocks when the target note is out-of-scope", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "note_append", {
      content: "added text",
      file: "private/note",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

describe("note_prepend scope guard (Pattern A)", () => {
  it("blocks when the target note is out-of-scope", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "note_prepend", {
      content: "header",
      file: "private/note",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

describe("note_update scope guard (Pattern A)", () => {
  it("blocks when the target path is out-of-scope", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "note_update", {
      path: "private/note.md",
      content: "new content",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

describe("note_trash scope guard (Pattern A)", () => {
  it("blocks when the target path is out-of-scope", async () => {
    const { registerFileTools } = await import("../../../src/tools/files.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerFileTools(server);
    const result = await invoke(server, "note_trash", { path: "private/note.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

// ---------------------------------------------------------------------------
// PROPERTIES scope guards
// ---------------------------------------------------------------------------

describe("property_read scope guard (Pattern A)", () => {
  it("blocks when path is out-of-scope", async () => {
    const { registerPropertyTools } = await import("../../../src/tools/properties.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerPropertyTools(server);
    const result = await invoke(server, "property_read", {
      name: "status",
      path: "private/note.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("proceeds with a warning when no path/file given and scoping is enabled", async () => {
    const { registerPropertyTools } = await import("../../../src/tools/properties.js");
    mockIsScopingEnabled.mockReturnValue(true);
    mockRun.mockResolvedValue("active");
    const server = new McpServer({ name: "t", version: "0" });
    registerPropertyTools(server);
    // No file or path — scoping cannot be verified; should still call CLI.
    const result = await invoke(server, "property_read", { name: "status" });
    expect(mockRun).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });
});

describe("property_set scope guard (Pattern A)", () => {
  it("blocks when path is out-of-scope", async () => {
    const { registerPropertyTools } = await import("../../../src/tools/properties.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerPropertyTools(server);
    const result = await invoke(server, "property_set", {
      name: "status",
      value: "done",
      path: "private/note.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });

  it("proceeds with a warning when no path/file given and scoping is enabled", async () => {
    const { registerPropertyTools } = await import("../../../src/tools/properties.js");
    mockIsScopingEnabled.mockReturnValue(true);
    mockRun.mockResolvedValue("done");
    const server = new McpServer({ name: "t", version: "0" });
    registerPropertyTools(server);
    // No file or path — proceeds with warning.
    const result = await invoke(server, "property_set", {
      name: "status",
      value: "done",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TAGS scope guards
// ---------------------------------------------------------------------------

describe("backlinks scope guard (Pattern A)", () => {
  it("blocks when the source note path is out-of-scope", async () => {
    const { registerTagTools } = await import("../../../src/tools/tags.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTagTools(server);
    const result = await invoke(server, "backlinks", { file: "private/note" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TEMPLATES scope guards
// ---------------------------------------------------------------------------

describe("templates_list scope filtering (Pattern B)", () => {
  it("strips .vaultgate entries from template listing", async () => {
    const { registerTemplateTools } = await import("../../../src/tools/templates.js");
    mockRun.mockResolvedValue("Daily Note\n.vaultgate\nMeeting");
    mockIsVaultGateFile.mockImplementation((p: string) => p === ".vaultgate");
    const server = new McpServer({ name: "t", version: "0" });
    registerTemplateTools(server);
    const result = await invoke(server, "templates_list", {});
    expect(result.content[0].text).not.toContain(".vaultgate");
    expect(result.content[0].text).toContain("Daily Note");
  });

  it("filters out-of-scope templates when scoping is enabled", async () => {
    const { registerTemplateTools } = await import("../../../src/tools/templates.js");
    mockRun.mockResolvedValue("ai/template.md\nprivate/template.md");
    mockFilterByScope.mockImplementation((paths: string[]) =>
      paths.filter((p) => p.startsWith("ai/"))
    );
    const server = new McpServer({ name: "t", version: "0" });
    registerTemplateTools(server);
    const result = await invoke(server, "templates_list", {});
    expect(result.content[0].text).toContain("ai/template.md");
    expect(result.content[0].text).not.toContain("private/template.md");
  });
});

describe("templates_apply scope guard (Pattern A)", () => {
  it("blocks when the target path is out-of-scope", async () => {
    const { registerTemplateTools } = await import("../../../src/tools/templates.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTemplateTools(server);
    const result = await invoke(server, "templates_apply", {
      template: "Daily Note",
      path: "private/new.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

// ---------------------------------------------------------------------------
// URI scope guards
// ---------------------------------------------------------------------------

describe("note_open scope guard (Pattern A)", () => {
  it("blocks when the note path is out-of-scope", async () => {
    const { registerUriTools } = await import("../../../src/tools/uri.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerUriTools(server);
    const result = await invoke(server, "note_open", { file: "private/secret" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});

// ---------------------------------------------------------------------------
// SEARCH scope guard (Pattern D)
// ---------------------------------------------------------------------------

describe("search scope guard (Pattern D)", () => {
  it("blocks full-vault search when scoping is active", async () => {
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    mockIsScopingEnabled.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerSearchTools(server);
    const result = await invoke(server, "search", { query: "anything" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Full-vault search is not available");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("allows search when scoping is disabled", async () => {
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    mockRun.mockResolvedValue("result1\nresult2");
    const server = new McpServer({ name: "t", version: "0" });
    registerSearchTools(server);
    const result = await invoke(server, "search", { query: "test" });
    expect(result.isError).toBeUndefined();
    expect(mockRun).toHaveBeenCalledWith(["search", "query=test"]);
  });
});

// ---------------------------------------------------------------------------
// TASKS scope guards
// ---------------------------------------------------------------------------

describe("tasks_all scope guards", () => {
  it("blocks when a path argument is out-of-scope (Pattern A)", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_all", { path: "private/note.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("blocks vault-wide listing when scoping is active and no path given (Pattern D)", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockIsScopingEnabled.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_all", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Vault-wide task listing is not available");
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("tasks_pending scope guards", () => {
  it("blocks when a path argument is out-of-scope (Pattern A)", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_pending", { path: "private/note.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });

  it("blocks vault-wide listing when scoping is active and no path given (Pattern D)", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockIsScopingEnabled.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_pending", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Vault-wide task listing is not available");
  });
});

describe("tasks_daily scope guard", () => {
  it("blocks when today's daily note is out of the active scope", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockConfig.dailyNotesPath = "Daily Notes";
    mockIsScopingEnabled.mockReturnValue(true);
    mockIsNoteInScope.mockReturnValue(false);
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_daily", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("proceeds when scoping is disabled (no daily path scope check)", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockConfig.dailyNotesPath = "Daily Notes";
    mockRun.mockResolvedValue("- [ ] Task");
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_daily", {});
    expect(mockRun).toHaveBeenCalledWith(["tasks", "daily", "todo"]);
    expect(result.isError).toBeUndefined();
  });

  it("proceeds when scoping is enabled but dailyNotesPath is not configured", async () => {
    const { registerTaskTools } = await import("../../../src/tools/tasks.js");
    mockIsScopingEnabled.mockReturnValue(true);
    // dailyNotesPath remains undefined (not configured)
    mockRun.mockResolvedValue("- [ ] Task");
    const server = new McpServer({ name: "t", version: "0" });
    registerTaskTools(server);
    const result = await invoke(server, "tasks_daily", {});
    expect(mockRun).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DAILY scope guards
// ---------------------------------------------------------------------------

describe("daily_read scope guard", () => {
  it("blocks daily_read when today's daily note is out of the active scope", async () => {
    const { registerDailyTools } = await import("../../../src/tools/daily.js");
    mockConfig.dailyNotesPath = "Daily Notes";
    mockIsScopingEnabled.mockReturnValue(true);
    mockIsNoteInScope.mockReturnValue(false);
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_read", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("proceeds when scoping is enabled but dailyNotesPath is not configured", async () => {
    const { registerDailyTools } = await import("../../../src/tools/daily.js");
    mockIsScopingEnabled.mockReturnValue(true);
    // dailyNotesPath is undefined — no scope check possible, proceed
    mockRun.mockResolvedValue("# Today");
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_read", {});
    expect(result.isError).toBeUndefined();
    expect(mockRun).toHaveBeenCalledWith(["daily:read"]);
  });

  it("proceeds when scoping is disabled (checkDailyScope is a no-op)", async () => {
    const { registerDailyTools } = await import("../../../src/tools/daily.js");
    mockConfig.dailyNotesPath = "Daily Notes";
    // isScopingEnabled stays false (default)
    mockRun.mockResolvedValue("# Today");
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_read", {});
    expect(result.isError).toBeUndefined();
    expect(mockRun).toHaveBeenCalled();
  });
});

describe("daily_append scope guard", () => {
  it("blocks daily_append when today's daily note is out of the active scope", async () => {
    const { registerDailyTools } = await import("../../../src/tools/daily.js");
    mockConfig.dailyNotesPath = "Daily Notes";
    mockIsScopingEnabled.mockReturnValue(true);
    mockIsNoteInScope.mockReturnValue(false);
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_append", {
      content: "- [ ] new task",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CONTEXT guard — scope conventions injection (lines 99-106 in context.ts)
// ---------------------------------------------------------------------------

describe("context guard scope conventions injection", () => {
  it("appends scope conventions to global conventions when a scope file is declared", async () => {
    const { installContextGuard, registerContextTools } = await import(
      "../../../src/tools/context.js"
    );
    mockGetScopeConventionsFile.mockReturnValue("VAULTGATE-ai.md");
    mockRun
      .mockResolvedValueOnce("Global conventions")
      .mockResolvedValueOnce("AI scope conventions");
    const server = new McpServer({ name: "t", version: "0" });
    installContextGuard(server);
    registerContextTools(server);
    // vault_context_set dryRun=true: no CLI call from the tool, but the guard fires.
    const result = await invoke(server, "vault_context_set", {
      content: "new conventions",
      dryRun: true,
    });
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenNthCalledWith(1, ["read", "path=VAULTGATE.md"]);
    expect(mockRun).toHaveBeenNthCalledWith(2, ["read", "path=VAULTGATE-ai.md"]);
    const text: string = result.content[0].text;
    expect(text).toContain("Global conventions");
    expect(text).toContain("AI scope conventions");
    expect(text).toContain("---");
  });

  it("silently skips scope conventions when the scope file cannot be read", async () => {
    const { installContextGuard, registerContextTools } = await import(
      "../../../src/tools/context.js"
    );
    mockGetScopeConventionsFile.mockReturnValue("VAULTGATE-ai.md");
    mockRun
      .mockResolvedValueOnce("Global conventions")
      .mockRejectedValueOnce(new Error("file not found"));
    const server = new McpServer({ name: "t", version: "0" });
    installContextGuard(server);
    registerContextTools(server);
    const result = await invoke(server, "vault_context_set", {
      content: "new conventions",
      dryRun: true,
    });
    expect(result.isError).toBeUndefined();
    const text: string = result.content[0].text;
    expect(text).toContain("Global conventions");
    expect(text).not.toContain("AI scope");
  });
});

// ---------------------------------------------------------------------------
// SEMANTIC find_similar scope guard (Pattern A)
// ---------------------------------------------------------------------------

describe("find_similar scope guard (Pattern A)", () => {
  it("blocks when the source note path is out-of-scope", async () => {
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    mockIsPathBlocked.mockReturnValue(true);
    const server = new McpServer({ name: "t", version: "0" });
    registerSemanticTools(server);
    const result = await invoke(server, "find_similar", { note_path: "private/note.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(BLOCKED_MSG);
  });
});
