import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/uri.js", () => ({ runUri: vi.fn() }));

const { runUri } = await import("../../../src/uri.js");
const mockRunUri = vi.mocked(runUri);

const { registerUriTools } = await import("../../../src/tools/uri.js");
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function makeServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerUriTools(server);
  return server;
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>
) {
  // @ts-ignore
  return await server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

describe("note_open", () => {
  beforeEach(() => vi.resetAllMocks());

  it("opens note by path", async () => {
    mockRunUri.mockResolvedValue(undefined);
    const server = makeServer();
    const result = await callTool(server, "note_open", { path: "Projects/Note.md" });
    expect(result.isError).toBeFalsy();
    expect(mockRunUri).toHaveBeenCalledWith("open", { file: "Projects/Note.md" });
  });

  it("path takes precedence over file", async () => {
    mockRunUri.mockResolvedValue(undefined);
    const server = makeServer();
    await callTool(server, "note_open", { path: "Projects/Note.md", file: "Note" });
    expect(mockRunUri).toHaveBeenCalledWith("open", expect.objectContaining({ file: "Projects/Note.md" }));
  });

  it("forwards heading and block params", async () => {
    mockRunUri.mockResolvedValue(undefined);
    const server = makeServer();
    await callTool(server, "note_open", { file: "Note", heading: "Section", block: "abc123" });
    expect(mockRunUri).toHaveBeenCalledWith("open", {
      file: "Note",
      heading: "Section",
      block: "abc123",
    });
  });

  it("returns isError when neither file nor path provided", async () => {
    const server = makeServer();
    const result = await callTool(server, "note_open", {});
    expect(result.isError).toBe(true);
    expect(mockRunUri).not.toHaveBeenCalled();
  });

  it("returns isError on runUri failure", async () => {
    mockRunUri.mockRejectedValue(new Error("launcher not found"));
    const server = makeServer();
    const result = await callTool(server, "note_open", { file: "Note" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("launcher not found");
  });
});

describe("search_open", () => {
  beforeEach(() => vi.resetAllMocks());

  it("forwards query to runUri", async () => {
    mockRunUri.mockResolvedValue(undefined);
    const server = makeServer();
    const result = await callTool(server, "search_open", { query: "hello world" });
    expect(result.isError).toBeFalsy();
    expect(mockRunUri).toHaveBeenCalledWith("search", { query: "hello world" });
  });

  it("returns isError on runUri failure", async () => {
    mockRunUri.mockRejectedValue(new Error("xdg-open not found"));
    const server = makeServer();
    const result = await callTool(server, "search_open", { query: "test" });
    expect(result.isError).toBe(true);
  });
});

describe("daily_open", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls runUri with empty params", async () => {
    mockRunUri.mockResolvedValue(undefined);
    const server = makeServer();
    const result = await callTool(server, "daily_open", {});
    expect(result.isError).toBeFalsy();
    expect(mockRunUri).toHaveBeenCalledWith("daily", {});
  });

  it("returns isError on runUri failure", async () => {
    mockRunUri.mockRejectedValue(new Error("URI open error"));
    const server = makeServer();
    const result = await callTool(server, "daily_open", {});
    expect(result.isError).toBe(true);
  });
});
