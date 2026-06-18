import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTemplateTools } from "../../../src/tools/templates.js";

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
  registerTemplateTools(server);
  return server;
}

describe("templates_list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian templates list", async () => {
    mockRun.mockResolvedValue("Daily Note\nMeeting");
    const result = await invoke(makeServer(), "templates_list", {});
    expect(mockRun).toHaveBeenCalledWith(["templates", "list"]);
    expect(result.content[0].text).toContain("Daily Note");
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("vault error"));
    const result = await invoke(makeServer(), "templates_list", {});
    expect(result.isError).toBe(true);
  });
});

describe("templates_apply (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "templates_apply", { template: "Daily Note" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("templates apply");
  });

  it("executes with template and file when dryRun=false", async () => {
    mockRun.mockResolvedValue("Template applied.");
    await invoke(makeServer(), "templates_apply", {
      template: "Meeting",
      file: "My Meeting",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "templates",
      "apply",
      "template=Meeting",
      "file=My Meeting",
    ]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("template not found"));
    const result = await invoke(makeServer(), "templates_apply", {
      template: "Missing",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
  });

  it("uses fallback message when CLI returns empty output", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "templates_apply", {
      template: "Daily",
      dryRun: false,
    });
    expect(result.content[0].text).toContain("applied");
  });
});
