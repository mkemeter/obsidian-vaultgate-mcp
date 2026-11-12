import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFileTools } from "../../../src/tools/files.js";
import { WIN32_CONTENT_LIMIT, DARWIN_CONTENT_LIMIT } from "../../../src/tools/_helpers.js";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
function setPlatform(p: string) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}
function restorePlatform() {
  Object.defineProperty(process, "platform", platformDescriptor);
}

function invoke(server: McpServer, name: string, args: Record<string, unknown>) {
  // @ts-ignore
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

function makeServer() {
  const server = new McpServer({ name: "t", version: "0" });
  registerFileTools(server);
  return server;
}

describe("files_list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian files list and returns output", async () => {
    mockRun.mockResolvedValue("note1.md\nnote2.md");
    const result = await invoke(makeServer(), "files_list", {});
    expect(mockRun).toHaveBeenCalledWith(["files", "list"]);
    expect(result.content[0].text).toContain("note1.md");
  });

  it("appends sort arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "files_list", { sort: "modified" });
    expect(mockRun).toHaveBeenCalledWith(["files", "list", "sort=modified"]);
  });

  it("appends limit arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "files_list", { limit: 5 });
    expect(mockRun).toHaveBeenCalledWith(["files", "list", "limit=5"]);
  });

  it("returns isError=true on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault not found"));
    const result = await invoke(makeServer(), "files_list", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault not found");
  });
});

describe("files_read", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian read with file arg", async () => {
    mockRun.mockResolvedValue("# My Note\nContent here.");
    await invoke(makeServer(), "files_read", { file: "My Note" });
    expect(mockRun).toHaveBeenCalledWith(["read", "file=My Note"]);
  });

  it("uses path= when path is provided (takes precedence)", async () => {
    mockRun.mockResolvedValue("content");
    await invoke(makeServer(), "files_read", { file: "ignored", path: "folder/note.md" });
    expect(mockRun).toHaveBeenCalledWith(["read", "path=folder/note.md"]);
  });

  it("calls without file args when neither file nor path is given", async () => {
    mockRun.mockResolvedValue("content");
    await invoke(makeServer(), "files_read", {});
    expect(mockRun).toHaveBeenCalledWith(["read"]);
  });

  // regression: files_read with file="" silently resolved to active file instead of erroring
  it("returns isError when file is an empty string", async () => {
    const result = await invoke(makeServer(), "files_read", { file: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/file name must not be empty/i);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns isError when path is an empty string", async () => {
    const result = await invoke(makeServer(), "files_read", { path: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/file name must not be empty/i);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns isError=true on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("read failed"));
    const result = await invoke(makeServer(), "files_read", { file: "My Note" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("read failed");
  });
});

describe("note_create (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default (dryRun=true)", async () => {
    const result = await invoke(makeServer(), "note_create", { name: "Test Note" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("obsidian create name=Test Note");
  });

  it("executes when dryRun=false", async () => {
    mockRun.mockResolvedValue("Note created.");
    await invoke(makeServer(), "note_create", { name: "Test Note", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["create", "name=Test Note"]);
  });

  it("executes when dryRun passed as string 'false' (client serialisation fix)", async () => {
    mockRun.mockResolvedValue("Note created.");
    await invoke(makeServer(), "note_create", { name: "Test Note", dryRun: "false" });
    expect(mockRun).toHaveBeenCalledWith(["create", "name=Test Note"]);
  });

  it("uses path= when path is provided (subfolder support)", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_create", {
      path: "Projects/2026-06 My Note.md",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["create", "path=Projects/2026-06 My Note.md"]);
  });

  it("path= takes precedence over name= when both provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_create", {
      name: "ignored",
      path: "Folder/Note.md",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["create", "path=Folder/Note.md"]);
  });

  it("includes content arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_create", { name: "Note", content: "# Hello", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["create", "name=Note", "content=# Hello"]);
  });

  it("includes overwrite flag when true", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_create", { name: "Note", overwrite: true, dryRun: false });
    const args = mockRun.mock.calls[0][0];
    expect(args).toContain("overwrite");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("create failed"));
    const result = await invoke(makeServer(), "note_create", { name: "Note", dryRun: false });
    expect(result.isError).toBe(true);
  });

  it("returns isError when neither name nor path is given (no target)", async () => {
    const result = await invoke(makeServer(), "note_create", { content: "# X" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/provide `name` .* or `path`/i);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns isError when name is an empty string", async () => {
    const result = await invoke(makeServer(), "note_create", { name: "", dryRun: false });
    expect(result.isError).toBe(true);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns isError when path is an empty string", async () => {
    const result = await invoke(makeServer(), "note_create", { path: "", dryRun: false });
    expect(result.isError).toBe(true);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns isError in dry-run mode when no target is given (guard before preview)", async () => {
    const result = await invoke(makeServer(), "note_create", { name: "   " });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("[DRY RUN]");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("blocks execution on Windows when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_create", {
        name: "Note",
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("allows dry run on Windows even when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_create", {
        name: "Note",
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[DRY RUN]");
    } finally {
      restorePlatform();
    }
  });

  it("blocks execution on macOS when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_create", {
        name: "Note",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(result.content[0].text).toContain("macOS");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("allows dry run on macOS even when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_create", {
        name: "Note",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[DRY RUN]");
    } finally {
      restorePlatform();
    }
  });

  it("allows large content on Linux regardless of size", async () => {
    setPlatform("linux");
    mockRun.mockResolvedValue("Note created.");
    try {
      const result = await invoke(makeServer(), "note_create", {
        name: "Note",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBeFalsy();
      expect(mockRun).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "note_append", { content: "new line" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
  });

  it("executes with correct args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_append", {
      content: "new line",
      file: "My Note",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["append", "content=new line", "file=My Note"]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("append failed"));
    const result = await invoke(makeServer(), "note_append", { content: "x", dryRun: false });
    expect(result.isError).toBe(true);
  });

  it("blocks execution on Windows when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_append", {
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("blocks execution on macOS when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_append", {
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(result.content[0].text).toContain("macOS");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("allows large content on Linux regardless of size", async () => {
    setPlatform("linux");
    mockRun.mockResolvedValue("");
    try {
      const result = await invoke(makeServer(), "note_append", {
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBeFalsy();
      expect(mockRun).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});

describe("note_prepend (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "note_prepend", { content: "header" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("prepend");
  });

  it("executes with correct args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_prepend", {
      content: "# 2025-06-01",
      file: "My Note",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["prepend", "content=# 2025-06-01", "file=My Note"]);
  });

  it("uses path= when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_prepend", {
      content: "header",
      path: "HR/Jona Kuhn.md",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["prepend", "content=header", "path=HR/Jona Kuhn.md"]);
  });

  it("returns fallback message when CLI returns empty string", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "note_prepend", { content: "x", dryRun: false });
    expect(result.content[0].text).toBe("Content prepended.");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("prepend failed"));
    const result = await invoke(makeServer(), "note_prepend", { content: "x", dryRun: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("prepend failed");
  });

  it("blocks execution on Windows when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_prepend", {
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("blocks execution on macOS when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_prepend", {
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(result.content[0].text).toContain("macOS");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});

describe("note_update (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "note_update", {
      path: "HR/Jona Kuhn.md",
      content: "# Updated",
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("create");
    expect(result.content[0].text).toContain("overwrite");
  });

  it("executes with correct args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_update", {
      path: "HR/Jona Kuhn.md",
      content: "# Full replacement content",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "create",
      "path=HR/Jona Kuhn.md",
      "content=# Full replacement content",
      "overwrite",
    ]);
  });

  it("returns fallback message when CLI returns empty string", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "note_update", {
      path: "HR/note.md",
      content: "x",
      dryRun: false,
    });
    expect(result.content[0].text).toBe("Updated: HR/note.md");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("file not found"));
    const result = await invoke(makeServer(), "note_update", {
      path: "missing.md",
      content: "x",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("file not found");
  });

  it("blocks execution on Windows when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_update", {
        path: "note.md",
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(result.content[0].text).toContain("note_update");
      expect(result.content[0].text).toContain("note_append");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("allows dry run on Windows even when content exceeds limit", async () => {
    setPlatform("win32");
    try {
      const result = await invoke(makeServer(), "note_update", {
        path: "note.md",
        content: "x".repeat(WIN32_CONTENT_LIMIT + 1),
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[DRY RUN]");
    } finally {
      restorePlatform();
    }
  });

  it("blocks execution on macOS when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_update", {
        path: "note.md",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Content too large");
      expect(result.content[0].text).toContain("macOS");
      expect(mockRun).not.toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });

  it("allows dry run on macOS even when content exceeds DARWIN limit", async () => {
    setPlatform("darwin");
    try {
      const result = await invoke(makeServer(), "note_update", {
        path: "note.md",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[DRY RUN]");
    } finally {
      restorePlatform();
    }
  });

  it("allows large content on Linux regardless of size", async () => {
    setPlatform("linux");
    mockRun.mockResolvedValue("");
    try {
      const result = await invoke(makeServer(), "note_update", {
        path: "note.md",
        content: "x".repeat(DARWIN_CONTENT_LIMIT + 1),
        dryRun: false,
      });
      expect(result.isError).toBeFalsy();
      expect(mockRun).toHaveBeenCalled();
    } finally {
      restorePlatform();
    }
  });
});

describe("note_trash (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "note_trash", { path: "HR/Jona Kuhn.md" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("delete");
    expect(result.content[0].text).toContain("HR/Jona Kuhn.md");
  });

  it("executes with correct args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "note_trash", { path: "HR/Jona Kuhn.md", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["delete", "path=HR/Jona Kuhn.md"]);
  });

  it("returns fallback message when CLI returns empty string", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "note_trash", { path: "old.md", dryRun: false });
    expect(result.content[0].text).toBe("Moved to trash: old.md");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("trash failed"));
    const result = await invoke(makeServer(), "note_trash", { path: "missing.md", dryRun: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("trash failed");
  });
});
