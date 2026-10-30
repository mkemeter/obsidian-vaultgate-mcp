/**
 * Integration tests for scope tool registration in createServer().
 *
 * Each test resets modules so config re-reads env vars and scope.ts starts
 * from a clean state. Uses vi.doMock to re-apply the CLI stub after reset.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultgate-scope-test-"));
});

afterEach(() => {
  try {
    fs.rmdirSync(tmpDir);
  } catch {
    // best-effort cleanup
  }
  vi.resetModules();
  delete process.env.OBSIDIAN_VAULT_PATH;
  delete process.env.VAULTGATE_SCOPE_SWITCHING;
});

async function listTools(): Promise<string[]> {
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
  it("does not register vault_scope when OBSIDIAN_VAULT_PATH is not set", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    const names = await listTools();
    expect(names).not.toContain("vault_scope");
    expect(names).not.toContain("vault_scope_set");
  });

  it("registers vault_scope when OBSIDIAN_VAULT_PATH is set to a valid directory", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.OBSIDIAN_VAULT_PATH = tmpDir;
    const names = await listTools();
    expect(names).toContain("vault_scope");
    expect(names).not.toContain("vault_scope_set");
  });

  it("registers both vault_scope and vault_scope_set when scope switching is enabled", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.OBSIDIAN_VAULT_PATH = tmpDir;
    process.env.VAULTGATE_SCOPE_SWITCHING = "true";
    const names = await listTools();
    expect(names).toContain("vault_scope");
    expect(names).toContain("vault_scope_set");
  });

  it("tool count matches BASE_TOOL_COUNT + SCOPE_TOOL_COUNT when scoping is enabled", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.OBSIDIAN_VAULT_PATH = tmpDir;
    const {
      createServer,
      BASE_TOOL_COUNT,
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
      BASE_TOOL_COUNT + SCOPE_TOOL_COUNT,
      BASE_TOOL_COUNT + SCOPE_TOOL_COUNT + SEMANTIC_TOOL_COUNT,
    ]).toContain(count);
  });
});
