import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

describe("search", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian search with query arg", async () => {
    mockRun.mockResolvedValue("result1\nresult2");
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSearchTools(server);

    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/call")?.(
      { method: "tools/call", params: { name: "search", arguments: { query: "meeting" } } },
      {}
    );
    expect(mockRun).toHaveBeenCalledWith(["search", "query=meeting"]);
    expect(result.content[0].text).toContain("result1");
  });

  it("appends limit when provided", async () => {
    mockRun.mockResolvedValue("");
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSearchTools(server);

    // @ts-ignore
    await server.server._requestHandlers.get("tools/call")?.(
      { method: "tools/call", params: { name: "search", arguments: { query: "test", limit: 10 } } },
      {}
    );
    expect(mockRun).toHaveBeenCalledWith(["search", "query=test", "limit=10"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("no results"));
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSearchTools(server);

    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/call")?.(
      { method: "tools/call", params: { name: "search", arguments: { query: "test" } } },
      {}
    );
    expect(result.isError).toBe(true);
  });
});
