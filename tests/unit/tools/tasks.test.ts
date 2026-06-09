import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTaskTools } from "../../../src/tools/tasks.js";

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
  registerTaskTools(server);
  return server;
}

describe("tasks_all", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian tasks all", async () => {
    mockRun.mockResolvedValue("- [x] Done\n- [ ] Pending");
    const result = await invoke(makeServer(), "tasks_all", {});
    expect(mockRun).toHaveBeenCalledWith(["tasks", "all"]);
    expect(result.content[0].text).toContain("Pending");
  });

  it("scopes to a file when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "tasks_all", { file: "My Note" });
    expect(mockRun).toHaveBeenCalledWith(["tasks", "all", "file=My Note"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "tasks_all", {});
    expect(result.isError).toBe(true);
  });
});

describe("tasks_pending", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian tasks pending", async () => {
    mockRun.mockResolvedValue("- [ ] Pending");
    await invoke(makeServer(), "tasks_pending", {});
    expect(mockRun).toHaveBeenCalledWith(["tasks", "pending"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "tasks_pending", {});
    expect(result.isError).toBe(true);
  });
});

describe("tasks_daily", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian tasks daily todo", async () => {
    mockRun.mockResolvedValue("- [ ] Daily task");
    await invoke(makeServer(), "tasks_daily", {});
    expect(mockRun).toHaveBeenCalledWith(["tasks", "daily", "todo"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "tasks_daily", {});
    expect(result.isError).toBe(true);
  });
});
