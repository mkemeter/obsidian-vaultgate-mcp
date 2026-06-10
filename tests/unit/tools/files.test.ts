import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFileTools } from "../../../src/tools/files.js";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

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
});

describe("note_append (destructive)", () => {
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
});
