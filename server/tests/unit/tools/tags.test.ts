import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTagTools } from "../../../src/tools/tags.js";

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
  registerTagTools(server);
  return server;
}

describe("tags", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian tags without args by default", async () => {
    mockRun.mockResolvedValue("#work\n#personal");
    await invoke(makeServer(), "tags", {});
    expect(mockRun).toHaveBeenCalledWith(["tags"]);
  });

  it("appends sort and counts when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "tags", { sort: "count", counts: true });
    expect(mockRun).toHaveBeenCalledWith(["tags", "sort=count", "counts"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "tags", {});
    expect(result.isError).toBe(true);
  });
});

describe("backlinks", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian backlinks for a given file", async () => {
    mockRun.mockResolvedValue("note-a.md\nnote-b.md");
    await invoke(makeServer(), "backlinks", { file: "My Note" });
    expect(mockRun).toHaveBeenCalledWith(["backlinks", "file=My Note"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "backlinks", { file: "x" });
    expect(result.isError).toBe(true);
  });
});

describe("unresolved", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian unresolved", async () => {
    mockRun.mockResolvedValue("broken-link.md");
    await invoke(makeServer(), "unresolved", {});
    expect(mockRun).toHaveBeenCalledWith(["unresolved"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "unresolved", {});
    expect(result.isError).toBe(true);
  });
});
