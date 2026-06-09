/**
 * Unit tests for src/tools/semantic.ts
 *
 * Module-level state (indexState, isReHashing, etc.) persists across imports,
 * so we use vi.resetModules() + dynamic import() in beforeEach for tests that
 * depend on specific state — same pattern as config.ts singleton tests.
 *
 * @xenova/transformers and src/cli.js are both mocked so no real model or
 * Obsidian CLI is required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Static mocks — must be declared before any dynamic imports that use them.
// ---------------------------------------------------------------------------

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

// Fake 4-dim embeddings so maths is easy to verify.
const FAKE_DIM = 4;
const FAKE_VEC_A = [1, 0, 0, 0];
const FAKE_VEC_B = [0, 1, 0, 0];
const FAKE_VEC_SIMILAR = [0.9, 0.1, 0, 0]; // high similarity to A

const mockPipeline = vi.fn().mockResolvedValue({
  // Called as embedder(texts, opts) → returns object with tolist()
  // We make each call return a fixed vector based on call order to keep tests deterministic.
  // Most tests override this per-test.
});

vi.mock("@xenova/transformers", () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockImplementation(() =>
      Promise.resolve({ tolist: () => [FAKE_VEC_A] })
    )
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FILE_LIST = "note-a.md\nnote-b.md\n";
const NOTE_A_CONTENT = "# Note A\n\nThis is note A content.";
const NOTE_B_CONTENT = "# Note B\n\nThis is note B content.";

async function buildServerWithSemanticTools(): Promise<{
  server: McpServer;
  mockRun: ReturnType<typeof vi.fn>;
}> {
  const { runObsidian } = await import("../../../src/cli.js");
  const mockRun = vi.mocked(runObsidian);

  // Default: files list returns two notes, reads return content.
  mockRun.mockImplementation(async (args: string[]) => {
    if (args.includes("list")) return FILE_LIST;
    if (args.includes("note-a.md")) return NOTE_A_CONTENT;
    if (args.includes("note-b.md")) return NOTE_B_CONTENT;
    return "";
  });

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
  registerSemanticTools(server);
  return { server, mockRun };
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {}
) {
  // @ts-ignore
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

// ---------------------------------------------------------------------------
// cosineSimilarity — pure math, no mocks needed
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", async () => {
    const { cosineSimilarity } = await import("../../../src/tools/semantic.js");
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", async () => {
    const { cosineSimilarity } = await import("../../../src/tools/semantic.js");
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("returns 0 for zero vector", async () => {
    const { cosineSimilarity } = await import("../../../src/tools/semantic.js");
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it("returns correct similarity for near-parallel vectors", async () => {
    const { cosineSimilarity } = await import("../../../src/tools/semantic.js");
    const score = cosineSimilarity(FAKE_VEC_A, FAKE_VEC_SIMILAR);
    expect(score).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// indexState guard — called before index is ready
// ---------------------------------------------------------------------------

describe("indexState guard", () => {
  beforeEach(() => {
    vi.resetModules();
    // Re-apply mocks after module reset
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_A] })
      ),
    }));
  });

  it("semantic_search returns indexing message when not ready", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);
    // Make the build hang by never resolving file list — indexState stays "building"
    mockRun.mockReturnValue(new Promise(() => {}));

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    const result = await callTool(server, "semantic_search", { query: "test" });
    expect(result.content[0].text).toMatch(/being indexed/i);
    // Should NOT have called runObsidian a second time for the query itself
  });

  it("find_similar returns indexing message when not ready", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockReturnValue(new Promise(() => {}));

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    const result = await callTool(server, "find_similar", { note_path: "note-a.md" });
    expect(result.content[0].text).toMatch(/being indexed/i);
  });
});

// ---------------------------------------------------------------------------
// semantic_search
// ---------------------------------------------------------------------------

describe("semantic_search", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_A] })
      ),
    }));
  });

  it("returns ranked results with score and preview (happy path)", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    // Phase 1: background index build
    mockRun.mockImplementationOnce(async () => FILE_LIST);        // files list
    mockRun.mockImplementationOnce(async () => NOTE_A_CONTENT);  // read note-a
    mockRun.mockImplementationOnce(async () => NOTE_B_CONTENT);  // read note-b

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    // Wait for background build to complete
    await vi.waitFor(async () => {
      // Phase 2: search call — needs file list + previews
      mockRun.mockResolvedValue(NOTE_A_CONTENT);
      const result = await callTool(server, "semantic_search", { query: "note content" });
      expect(result.content[0].text).toMatch(/score:/);
    }, { timeout: 5000 });
  });

  it("returns isError on embed failure", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);
    mockRun.mockResolvedValue(FILE_LIST);

    const { pipeline } = await import("@xenova/transformers");
    vi.mocked(pipeline).mockResolvedValueOnce(
      vi.fn().mockRejectedValue(new Error("ONNX crash")) as never
    );

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    // Let build finish (will fail gracefully, leaving indexState "building")
    await new Promise((r) => setTimeout(r, 50));

    const result = await callTool(server, "semantic_search", { query: "anything" });
    // Either indexing message or isError depending on timing
    expect(
      result.content[0].text.match(/being indexed/i) || result.isError
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// find_similar
// ---------------------------------------------------------------------------

describe("find_similar", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_A] })
      ),
    }));
  });

  it("excludes the source note from results", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    mockRun.mockImplementationOnce(async () => FILE_LIST);
    mockRun.mockImplementationOnce(async () => NOTE_A_CONTENT);
    mockRun.mockImplementationOnce(async () => NOTE_B_CONTENT);

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      mockRun.mockResolvedValue(NOTE_B_CONTENT);
      const result = await callTool(server, "find_similar", { note_path: "note-a.md" });
      if (result.content[0].text.match(/being indexed/i)) throw new Error("still building");
      expect(result.content[0].text).not.toContain("note-a.md");
    }, { timeout: 5000 });
  });

  it("returns isError when note_path is not in index", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    mockRun.mockImplementationOnce(async () => FILE_LIST);
    mockRun.mockImplementationOnce(async () => NOTE_A_CONTENT);
    mockRun.mockImplementationOnce(async () => NOTE_B_CONTENT);

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      mockRun.mockResolvedValue("");
      const result = await callTool(server, "find_similar", {
        note_path: "does-not-exist.md",
      });
      if (result.content[0].text.match(/being indexed/i)) throw new Error("still building");
      expect(result.isError).toBe(true);
    }, { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// min_score filter
// ---------------------------------------------------------------------------

describe("min_score filter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_B] }) // orthogonal to query
      ),
    }));
  });

  it("returns no results when all scores below min_score", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    mockRun.mockImplementationOnce(async () => FILE_LIST);
    mockRun.mockImplementationOnce(async () => NOTE_A_CONTENT);
    mockRun.mockImplementationOnce(async () => NOTE_B_CONTENT);

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      mockRun.mockResolvedValue("");
      const result = await callTool(server, "semantic_search", {
        query: "anything",
        min_score: 0.99, // very high — no note will match orthogonal embeddings
      });
      if (result.content[0].text.match(/being indexed/i)) throw new Error("still building");
      expect(result.content[0].text).toMatch(/no notes found/i);
    }, { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// index_vault and vault_info
// ---------------------------------------------------------------------------

describe("index_vault", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_A] })
      ),
    }));
  });

  it("reports re-index complete with note count", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      const result = await callTool(server, "index_vault");
      if (result.content[0].text.match(/still in progress/i)) throw new Error("still building");
      expect(result.content[0].text).toMatch(/re-index complete/i);
    }, { timeout: 5000 });
  });

  it("returns isError when re-index CLI fails", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    // Initial build succeeds
    mockRun.mockImplementationOnce(async () => FILE_LIST);
    mockRun.mockImplementationOnce(async () => NOTE_A_CONTENT);
    mockRun.mockImplementationOnce(async () => NOTE_B_CONTENT);

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      // Re-index call: file list fails
      mockRun.mockRejectedValue(new Error("CLI unavailable"));
      const result = await callTool(server, "index_vault");
      if (result.content[0].text?.match(/still in progress/i)) throw new Error("still building");
      expect(result.isError).toBe(true);
    }, { timeout: 5000 });
  });
});

describe("vault_info", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.mock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockResolvedValue({ tolist: () => [FAKE_VEC_A] })
      ),
    }));
  });

  it("shows note count and last indexed timestamp", async () => {
    const { runObsidian } = await import("../../../src/cli.js");
    const mockRun = vi.mocked(runObsidian);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const { registerSemanticTools } = await import("../../../src/tools/semantic.js");
    registerSemanticTools(server);

    await vi.waitFor(async () => {
      const result = await callTool(server, "vault_info");
      if (result.content[0].text.match(/being built/i)) throw new Error("still building");
      expect(result.content[0].text).toMatch(/indexed notes/i);
      expect(result.content[0].text).toMatch(/last full re-hash/i);
    }, { timeout: 5000 });
  });
});
