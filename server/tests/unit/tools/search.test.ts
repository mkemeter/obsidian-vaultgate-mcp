import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));
vi.mock("../../../src/scope.js", () => ({ isScopingEnabled: vi.fn().mockReturnValue(false) }));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);
const { isScopingEnabled } = await import("../../../src/scope.js");
const mockScoping = vi.mocked(isScopingEnabled);

describe("search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockScoping.mockReturnValue(false);
  });

  it("returns isError when vault scoping is active", async () => {
    // regression: search uses Obsidian native search which cannot be scope-filtered;
    // it must be blocked when scoping is enabled rather than leaking cross-scope results.
    mockScoping.mockReturnValue(true);
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
    expect(result.content[0].text).toContain("scoping is active");
    expect(mockRun).not.toHaveBeenCalled();
  });

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

  it("coerces string limit to number (preprocessor branch)", async () => {
    mockRun.mockResolvedValue("");
    const { registerSearchTools } = await import("../../../src/tools/search.js");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSearchTools(server);

    // @ts-ignore
    await server.server._requestHandlers.get("tools/call")?.(
      { method: "tools/call", params: { name: "search", arguments: { query: "test", limit: "5" } } },
      {}
    );
    expect(mockRun).toHaveBeenCalledWith(["search", "query=test", "limit=5"]);
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
