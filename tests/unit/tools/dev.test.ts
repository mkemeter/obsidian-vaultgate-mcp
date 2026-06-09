import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDevTools } from "../../../src/tools/dev.js";

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
  registerDevTools(server);
  return server;
}

describe("eval (destructive ⚠️)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "eval", { code: "app.vault.getFiles().length" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("eval");
  });

  it("executes when dryRun=false and returns output", async () => {
    mockRun.mockResolvedValue("42");
    const result = await invoke(makeServer(), "eval", {
      code: "app.vault.getFiles().length",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith(["eval", "code=app.vault.getFiles().length"]);
    expect(result.content[0].text).toBe("42");
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("eval error"));
    const result = await invoke(makeServer(), "eval", { code: "bad", dryRun: false });
    expect(result.isError).toBe(true);
  });

  it("tool description contains explicit ⚠️ warning", async () => {
    const server = makeServer();
    // @ts-ignore
    const toolsResult = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );
    const evalTool = toolsResult?.tools?.find((t: any) => t.name === "eval");
    expect(evalTool?.description).toContain("⚠️");
    expect(evalTool?.description).toContain("arbitrary JavaScript");
    expect(evalTool?.description).toContain("autonomously");
  });
});

describe("dev_errors (read-only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian dev:errors", async () => {
    mockRun.mockResolvedValue("TypeError: foo is undefined");
    const result = await invoke(makeServer(), "dev_errors", {});
    expect(mockRun).toHaveBeenCalledWith(["dev:errors"]);
    expect(result.content[0].text).toContain("TypeError");
  });

  it("returns friendly message when no errors", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "dev_errors", {});
    expect(result.content[0].text).toContain("No errors found.");
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("dev error"));
    const result = await invoke(makeServer(), "dev_errors", {});
    expect(result.isError).toBe(true);
  });
});

describe("dev_console (read-only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls dev:console with level filter", async () => {
    mockRun.mockResolvedValue("[warn] something");
    await invoke(makeServer(), "dev_console", { level: "warn" });
    expect(mockRun).toHaveBeenCalledWith(["dev:console", "level=warn"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("dev error"));
    const result = await invoke(makeServer(), "dev_console", {});
    expect(result.isError).toBe(true);
  });
});

describe("dev_css (read-only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls dev:css with selector and prop", async () => {
    mockRun.mockResolvedValue("rgba(0,0,0,0)");
    await invoke(makeServer(), "dev_css", { selector: ".workspace", prop: "background-color" });
    expect(mockRun).toHaveBeenCalledWith([
      "dev:css",
      "selector=.workspace",
      "prop=background-color",
    ]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("dev error"));
    const result = await invoke(makeServer(), "dev_css", { selector: ".x" });
    expect(result.isError).toBe(true);
  });
});

describe("dev_dom (read-only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls dev:dom with selector", async () => {
    mockRun.mockResolvedValue("<div class='workspace'>...");
    await invoke(makeServer(), "dev_dom", { selector: ".workspace" });
    expect(mockRun).toHaveBeenCalledWith(["dev:dom", "selector=.workspace"]);
  });

  it("appends text flag when requested", async () => {
    mockRun.mockResolvedValue("workspace text");
    await invoke(makeServer(), "dev_dom", { selector: ".workspace", text: true });
    expect(mockRun).toHaveBeenCalledWith(["dev:dom", "selector=.workspace", "text"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("dev error"));
    const result = await invoke(makeServer(), "dev_dom", { selector: ".x" });
    expect(result.isError).toBe(true);
  });
});

describe("dev_screenshot (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "dev_screenshot", { path: "out.png" });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
  });

  it("executes when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "dev_screenshot", { path: "out.png", dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["dev:screenshot", "path=out.png"]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("screenshot failed"));
    const result = await invoke(makeServer(), "dev_screenshot", { path: "x.png", dryRun: false });
    expect(result.isError).toBe(true);
  });
});

describe("dev_mobile (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "dev_mobile", { on: true });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
  });

  it("sends 'on' when dryRun=false and on=true", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "dev_mobile", { on: true, dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["dev:mobile", "on"]);
  });

  it("sends 'off' when dryRun=false and on=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "dev_mobile", { on: false, dryRun: false });
    expect(mockRun).toHaveBeenCalledWith(["dev:mobile", "off"]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("mobile toggle failed"));
    const result = await invoke(makeServer(), "dev_mobile", { on: true, dryRun: false });
    expect(result.isError).toBe(true);
  });
});
