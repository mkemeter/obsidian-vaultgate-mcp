import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerContextTools } from "../../../src/tools/context.js";

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
  registerContextTools(server);
  return server;
}

describe("vault_context", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns file content when VAULTGATE.md exists", async () => {
    mockRun.mockResolvedValue("# Vault Conventions\nUse tags liberally.");
    const result = await invoke(makeServer(), "vault_context", {});
    expect(mockRun).toHaveBeenCalledWith(["read", "path=VAULTGATE.md"]);
    expect(result.content[0].text).toBe("# Vault Conventions\nUse tags liberally.");
    expect(result.isError).toBeUndefined();
  });

  it("returns not-found message when file is absent", async () => {
    mockRun.mockRejectedValue(new Error("File not found: VAULTGATE.md"));
    const result = await invoke(makeServer(), "vault_context", {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No VAULTGATE.md found");
    expect(result.content[0].text).toContain("vault_context_set");
  });

  it("returns isError=true on unexpected CLI error", async () => {
    mockRun.mockRejectedValue(new Error("obsidian process crashed"));
    const result = await invoke(makeServer(), "vault_context", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("obsidian process crashed");
  });
});

describe("vault_context_set", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry-run preview without calling CLI when dryRun=true", async () => {
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: true,
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("VAULTGATE.md");
  });

  it("calls CLI with correct args and returns success when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "create",
      "name=VAULTGATE.md",
      "content=# My Conventions",
      "overwrite",
    ]);
    expect(result.content[0].text).toContain("VAULTGATE.md updated");
    expect(result.isError).toBeUndefined();
  });

  it("returns isError=true when CLI fails on dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("vault write failed"));
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault write failed");
  });
});
