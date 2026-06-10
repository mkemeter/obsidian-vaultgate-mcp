import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPropertyTools } from "../../../src/tools/properties.js";

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
  registerPropertyTools(server);
  return server;
}

describe("property_read", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian property:read with name for active file", async () => {
    mockRun.mockResolvedValue("draft");
    const result = await invoke(makeServer(), "property_read", { name: "status" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status"]);
    expect(result.content[0].text).toContain("draft");
  });

  it("includes file arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_read", { name: "tags", file: "My Note" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=tags", "file=My Note"]);
  });

  it("includes path arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_read", { name: "status", path: "HR/note.md" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status", "path=HR/note.md"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("file not found"));
    const result = await invoke(makeServer(), "property_read", { name: "status" });
    expect(result.isError).toBe(true);
  });
});

describe("property_set (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("property:set");
  });

  it("executes with name, value, and file args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
      file: "My Note",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "property:set",
      "name=status",
      "value=done",
      "file=My Note",
    ]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("property error"));
    const result = await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
  });
});
