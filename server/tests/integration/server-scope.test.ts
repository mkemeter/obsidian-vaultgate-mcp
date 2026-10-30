/**
 * Integration tests for scope tool registration in createServer().
 *
 * Each test resets modules so config re-reads env vars and scope.ts starts
 * from a clean state. Uses vi.doMock to re-apply the CLI stub after reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.OBSIDIAN_SCOPE;
  delete process.env.VAULTGATE_SCOPE_SWITCHING;
});

/** Mocks CLI and returns a list of tools registered by createServer(). */
async function listTools(
  filesListOutput: string,
  readResponses: Record<string, string> = {}
): Promise<string[]> {
  vi.doMock("../../src/cli.js", () => ({
    runObsidian: vi.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "files:list") return filesListOutput;
      if (args[0] === "read") {
        const pathArg = args.find((a: string) => a.startsWith("path="))?.slice(5);
        if (pathArg !== undefined && Object.prototype.hasOwnProperty.call(readResponses, pathArg)) {
          return readResponses[pathArg];
        }
        throw new Error(`File not found: ${pathArg ?? "(none)"}`);
      }
      // initialize reads vault context — let it throw (not found is fine)
      return "";
    }),
  }));
  const { createServer } = await import("../../src/server.js");
  const server = await createServer();
  // @ts-ignore — internal handler
  const result = await server.server._requestHandlers.get("tools/list")?.(
    { method: "tools/list", params: {} },
    {}
  );
  return result.tools.map((t: { name: string }) => t.name);
}

describe("scope tool registration", () => {
  it("does not register vault_scope when vault has no scope zones", async () => {
    const names = await listTools("");
    expect(names).not.toContain("vault_scope");
    expect(names).not.toContain("vault_scope_set");
  });

  it("registers vault_scope when vault has at least one scope zone", async () => {
    const names = await listTools("Work/VAULTGATE.md", {
      "Work/VAULTGATE.md": "---\nscope: work\n---\n# Work",
    });
    expect(names).toContain("vault_scope");
    expect(names).not.toContain("vault_scope_set");
  });

  it("registers both vault_scope and vault_scope_set when scope switching is enabled", async () => {
    process.env.VAULTGATE_SCOPE_SWITCHING = "true";
    const names = await listTools("Work/VAULTGATE.md", {
      "Work/VAULTGATE.md": "---\nscope: work\n---\n# Work",
    });
    expect(names).toContain("vault_scope");
    expect(names).toContain("vault_scope_set");
  });

  it("tool count matches BASE_TOOL_COUNT + SCOPE_TOOL_COUNT when scoping is enabled", async () => {
    vi.doMock("../../src/cli.js", () => ({
      runObsidian: vi.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === "files:list") return "Work/VAULTGATE.md";
        if (args[0] === "read") {
          const p = args.find((a: string) => a.startsWith("path="))?.slice(5);
          if (p === "Work/VAULTGATE.md") return "---\nscope: work\n---\n# Work";
          throw new Error("not found");
        }
        return "";
      }),
    }));
    const {
      createServer,
      BASE_TOOL_COUNT,
      URI_TOOL_COUNT,
      SCOPE_TOOL_COUNT,
      SEMANTIC_TOOL_COUNT,
    } = await import("../../src/server.js");
    const server = await createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );
    const count: number = result.tools.length;
    expect([
      BASE_TOOL_COUNT + URI_TOOL_COUNT + SCOPE_TOOL_COUNT,
      BASE_TOOL_COUNT + URI_TOOL_COUNT + SCOPE_TOOL_COUNT + SEMANTIC_TOOL_COUNT,
    ]).toContain(count);
  });
});
