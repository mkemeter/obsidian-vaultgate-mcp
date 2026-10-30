import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock scope.ts so we control state without filesystem access.
vi.mock("../../../src/scope.js", () => ({
  getActiveScope: vi.fn(() => "ai"),
  getHomeScope: vi.fn(() => "ai"),
  discoverScopes: vi.fn(() => ["ai", "private", "unscoped"]),
  isScopeSwitchingEnabled: vi.fn(() => false),
  setActiveScope: vi.fn(),
}));

const {
  getActiveScope,
  getHomeScope,
  discoverScopes,
  isScopeSwitchingEnabled,
  setActiveScope,
} = await import("../../../src/scope.js");

const mockGetActiveScope = vi.mocked(getActiveScope);
const mockGetHomeScope = vi.mocked(getHomeScope);
const mockDiscoverScopes = vi.mocked(discoverScopes);
const mockIsScopeSwitchingEnabled = vi.mocked(isScopeSwitchingEnabled);
const mockSetActiveScope = vi.mocked(setActiveScope);

const { registerScopeTools } = await import("../../../src/tools/scope.js");

function makeServer(switchingEnabled = false) {
  mockIsScopeSwitchingEnabled.mockReturnValue(switchingEnabled);
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerScopeTools(server);
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

// Returns the list of registered tool names from the server.
async function registeredToolNames(server: McpServer): Promise<string[]> {
  // @ts-ignore
  const result = await server.server._requestHandlers.get("tools/list")?.(
    { method: "tools/list", params: {} },
    {}
  );
  return result.tools.map((t: { name: string }) => t.name);
}

describe("vault_scope", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns current, home, and available scopes as JSON", async () => {
    mockGetActiveScope.mockReturnValue("ai");
    mockGetHomeScope.mockReturnValue("ai");
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);

    const server = makeServer();
    const result = await callTool(server, "vault_scope", {});

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      current: "ai",
      home: "ai",
      available: ["ai", "private", "unscoped"],
    });
  });

  it("reflects the active scope at call time", async () => {
    mockGetActiveScope.mockReturnValue("private");
    mockGetHomeScope.mockReturnValue("unscoped");
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);

    const server = makeServer();
    const result = await callTool(server, "vault_scope", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.current).toBe("private");
    expect(parsed.home).toBe("unscoped");
  });

  it("always includes 'unscoped' in available", async () => {
    mockGetActiveScope.mockReturnValue("unscoped");
    mockGetHomeScope.mockReturnValue("unscoped");
    mockDiscoverScopes.mockReturnValue(["unscoped"]);

    const server = makeServer();
    const result = await callTool(server, "vault_scope", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.available).toContain("unscoped");
  });
});

describe("vault_scope_set", () => {
  beforeEach(() => vi.resetAllMocks());

  it("is not registered when VAULTGATE_SCOPE_SWITCHING=false", async () => {
    const server = makeServer(false);
    expect(await registeredToolNames(server)).not.toContain("vault_scope_set");
  });

  it("is registered when VAULTGATE_SCOPE_SWITCHING=true", async () => {
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);
    const server = makeServer(true);
    expect(await registeredToolNames(server)).toContain("vault_scope_set");
  });

  it("switches to a valid scope and returns confirmation", async () => {
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);
    const server = makeServer(true);

    const result = await callTool(server, "vault_scope_set", { scope: "private" });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("private");
    expect(mockSetActiveScope).toHaveBeenCalledWith("private");
  });

  it("returns isError for an unknown scope", async () => {
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);
    const server = makeServer(true);

    const result = await callTool(server, "vault_scope_set", { scope: "nonexistent" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nonexistent");
    expect(mockSetActiveScope).not.toHaveBeenCalled();
  });

  it("error message lists available scopes", async () => {
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);
    const server = makeServer(true);

    const result = await callTool(server, "vault_scope_set", { scope: "bogus" });

    const text: string = result.content[0].text;
    expect(text).toContain("ai");
    expect(text).toContain("private");
    expect(text).toContain("unscoped");
  });

  it("switching to the current scope succeeds (idempotent)", async () => {
    mockGetActiveScope.mockReturnValue("ai");
    mockDiscoverScopes.mockReturnValue(["ai", "private", "unscoped"]);
    const server = makeServer(true);

    const result = await callTool(server, "vault_scope_set", { scope: "ai" });

    expect(result.isError).toBeFalsy();
    expect(mockSetActiveScope).toHaveBeenCalledWith("ai");
  });
});

describe("vault_scope tool registration", () => {
  beforeEach(() => vi.resetAllMocks());

  it("vault_scope is always registered when registerScopeTools is called", async () => {
    const server = makeServer();
    expect(await registeredToolNames(server)).toContain("vault_scope");
  });
});
