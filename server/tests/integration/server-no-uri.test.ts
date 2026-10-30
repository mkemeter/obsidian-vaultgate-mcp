/**
 * Integration tests for VAULTGATE_NO_URI — disables note_open, search_open, daily_open.
 *
 * Each test resets modules so config re-reads env vars. Uses vi.doMock to
 * re-apply the CLI stub after each reset.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  delete process.env.VAULTGATE_NO_URI;
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

describe("VAULTGATE_NO_URI tool registration", () => {
  it("registers URI tools by default (VAULTGATE_NO_URI not set)", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    const names = await listTools();
    expect(names).toContain("note_open");
    expect(names).toContain("search_open");
    expect(names).toContain("daily_open");
  });

  it("does not register URI tools when VAULTGATE_NO_URI=true", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.VAULTGATE_NO_URI = "true";
    const names = await listTools();
    expect(names).not.toContain("note_open");
    expect(names).not.toContain("search_open");
    expect(names).not.toContain("daily_open");
  });

  it("tool count is BASE_TOOL_COUNT when VAULTGATE_NO_URI=true", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.VAULTGATE_NO_URI = "true";
    const { createServer, BASE_TOOL_COUNT, SEMANTIC_TOOL_COUNT } = await import(
      "../../src/server.js"
    );
    const server = await createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );
    const count: number = result.tools.length;
    expect([BASE_TOOL_COUNT, BASE_TOOL_COUNT + SEMANTIC_TOOL_COUNT]).toContain(count);
  });

  it("registers URI tools when VAULTGATE_NO_URI=false", async () => {
    vi.doMock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));
    process.env.VAULTGATE_NO_URI = "false";
    const names = await listTools();
    expect(names).toContain("note_open");
    expect(names).toContain("search_open");
    expect(names).toContain("daily_open");
  });
});
