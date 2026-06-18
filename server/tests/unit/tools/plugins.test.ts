import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPluginTools } from "../../../src/tools/plugins.js";

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
  registerPluginTools(server);
  return server;
}

describe("plugins_list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian plugins list", async () => {
    mockRun.mockResolvedValue("dataview 0.5\ntemplater 1.2");
    const result = await invoke(makeServer(), "plugins_list", {});
    expect(mockRun).toHaveBeenCalledWith(["plugins", "list"]);
    expect(result.content[0].text).toContain("dataview");
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "plugins_list", {});
    expect(result.isError).toBe(true);
  });
});

describe("plugin_reload (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "plugin_reload", { id: "dataview" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("plugin:reload");
  });

  it("executes with id arg when dryRun=false", async () => {
    mockRun.mockResolvedValue("Plugin reloaded.");
    await invoke(makeServer(), "plugin_reload", { id: "dataview", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["plugin:reload", "id=dataview"]);
  });

  it("uses fallback message when CLI returns empty output", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "plugin_reload", { id: "dataview", dryRun: false });
    expect(result.content[0].text).toContain("reloaded");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("plugin not found"));
    const result = await invoke(makeServer(), "plugin_reload", { id: "unknown", dryRun: false });
    expect(result.isError).toBe(true);
  });
});
