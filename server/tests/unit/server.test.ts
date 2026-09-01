/**
 * Unit tests for server.ts icon helpers.
 *
 * The integration test covers createServer() with the real icon present.
 * These unit tests cover the icon-absent paths (getIconSvg returns "",
 * getIconDataUri returns "", createServer skips icon metadata) and the
 * path where @xenova/transformers is unavailable (semanticModule undefined).
 *
 * node:fs is mocked to throw for icon.svg so the c8-ignored catch branch
 * in getIconSvg fires, exercising the downstream empty-string branches.
 *
 * tools/semantic.js is mocked to throw so the dynamic import inside
 * createServer() rejects — exercising the if (semanticModule) false branch.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((p: unknown, ...rest: unknown[]) => {
      if (typeof p === "string" && p.endsWith("icon.svg")) {
        throw Object.assign(new Error("ENOENT: icon.svg not found"), { code: "ENOENT" });
      }
      // biome-ignore lint/suspicious/noExplicitAny: forwarding real implementation
      return (actual.readFileSync as any)(p, ...rest);
    }),
  };
});

vi.mock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));

// Make the dynamic import of semantic tools fail so semanticModule stays undefined.
// This exercises the `if (semanticModule)` false branch at server.ts line 154.
vi.mock("../../src/tools/semantic.js", () => {
  throw new Error("@xenova/transformers not available in this environment");
});

const { getIconSvg, getIconDataUri, createServer } = await import("../../src/server.js");

describe("getIconSvg — icon absent", () => {
  it("returns empty string when the icon file is not found", () => {
    // regression: getIconSvg catch branch (server.ts) and the
    // getIconDataUri false arm (line 55) were never exercised
    expect(getIconSvg()).toBe("");
  });
});

describe("getIconDataUri — icon absent", () => {
  it("returns empty string when icon is missing", () => {
    expect(getIconDataUri()).toBe("");
  });
});

describe("createServer — icon absent, no semantic module", () => {
  it("creates a server without icon metadata when dataUri is empty", async () => {
    // regression: if (dataUri) false branch (server.ts line 85) was never exercised
    const server = await createServer();
    expect(server).toBeDefined();
    // @ts-ignore — verify icon metadata was NOT set (dataUri was "")
    const info = server.server._serverInfo as Record<string, unknown>;
    expect(info.icon).toBeUndefined();
    expect(info.icons).toBeUndefined();
  });

  it("creates a server even when semantic module import fails", async () => {
    // regression: if (semanticModule) false branch (server.ts line 154) was never exercised
    const server = await createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );
    // Without semantic tools, only BASE_TOOL_COUNT tools are registered
    const { BASE_TOOL_COUNT } = await import("../../src/server.js");
    expect(result.tools.length).toBe(BASE_TOOL_COUNT);
  });
});
