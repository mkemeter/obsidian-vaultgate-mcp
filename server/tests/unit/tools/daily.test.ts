import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDailyTools } from "../../../src/tools/daily.js";

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

describe("daily_read", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian daily:read", async () => {
    mockRun.mockResolvedValue("# 2025-01-01\n- [ ] Task");
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_read", {});
    expect(mockRun).toHaveBeenCalledWith(["daily:read"]);
    expect(result.content[0].text).toContain("Task");
  });

  it("returns isError on failure", async () => {
    mockRun.mockRejectedValue(new Error("no daily note"));
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_read", {});
    expect(result.isError).toBe(true);
  });
});

describe("daily_append (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_append", { content: "- [ ] New task" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("daily:append");
  });

  it("executes with correct args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    await invoke(server, "daily_append", { content: "- [ ] New task", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["daily:append", "content=- [ ] New task"]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("no daily note"));
    const server = new McpServer({ name: "t", version: "0" });
    registerDailyTools(server);
    const result = await invoke(server, "daily_append", { content: "x", dryRun: false });
    expect(result.isError).toBe(true);
  });
});
