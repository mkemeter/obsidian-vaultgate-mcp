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

/**
 * Builds a vi.doMock factory for cli.js that routes both runObsidian and
 * runObsidianAdmin through the same stub logic. Discovery calls go through
 * runObsidianAdmin; tool calls go through runObsidian.
 */
function makeCliMock(filesListOutput: string, readResponses: Record<string, string> = {}) {
  const handler = async (args: string[]) => {
    if (args[0] === "files" && args[1] === "list") return filesListOutput;
    if (args[0] === "read") {
      const pathArg = args.find((a: string) => a.startsWith("path="))?.slice(5);
      if (pathArg !== undefined && Object.prototype.hasOwnProperty.call(readResponses, pathArg)) {
        return readResponses[pathArg];
      }
      throw new Error(`File not found: ${pathArg ?? "(none)"}`);
    }
    return "";
  };
  return {
    runObsidian: vi.fn().mockImplementation(handler),
    runObsidianAdmin: vi.fn().mockImplementation(handler),
    installAccessGuard: vi.fn(),
    extractNotePath: vi.fn(),
    isCliWriteCommand: vi.fn(),
  };
}

/** Mocks CLI and returns a list of tools registered by createServer(). */
async function listTools(
  filesListOutput: string,
  readResponses: Record<string, string> = {}
): Promise<string[]> {
  vi.doMock("../../src/cli.js", () => makeCliMock(filesListOutput, readResponses));
  const { createServer } = await import("../../src/server.js");
  const server = await createServer();
  // @ts-ignore — internal handler
  const result = await server.server._requestHandlers.get("tools/list")?.(
    { method: "tools/list", params: {} },
    {}
  );
  return result.tools.map((t: { name: string }) => t.name);
}

/** Invokes a tool call on a server returned by createServer(). */
async function invokeTool(
  server: Awaited<ReturnType<typeof import("../../src/server.js").createServer>>,
  name: string,
  args: Record<string, unknown>
) {
  // @ts-ignore — internal handler
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
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
    vi.doMock("../../src/cli.js", () =>
      makeCliMock("Work/VAULTGATE.md", {
        "Work/VAULTGATE.md": "---\nscope: work\n---\n# Work",
      })
    );
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

describe("vault_scope_set access control", () => {
  it("returns error and does not switch when target scope has access: none", async () => {
    process.env.VAULTGATE_SCOPE_SWITCHING = "true";
    vi.doMock("../../src/cli.js", () =>
      makeCliMock(
        "Work/VAULTGATE.md\nPersonal/VAULTGATE.md",
        {
          "Work/VAULTGATE.md": "---\nscope: work\naccess: none\n---",
          "Personal/VAULTGATE.md": "---\nscope: personal\n---",
        }
      )
    );
    const { createServer } = await import("../../src/server.js");
    const { getActiveScope } = await import("../../src/scope.js");
    const server = await createServer();

    const result = await invokeTool(server, "vault_scope_set", { scope: "work" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no AI access/);
    // Active scope must not have changed
    expect(getActiveScope()).not.toBe("work");
  });
});
