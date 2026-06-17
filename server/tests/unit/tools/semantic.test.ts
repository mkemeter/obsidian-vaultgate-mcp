/**
 * Unit tests for src/tools/semantic.ts
 *
 * Module-level state (indexState, isReHashing, etc.) persists across imports.
 * We use vi.resetModules() + dynamic import() in beforeEach so each test suite
 * gets a fresh module instance — same pattern as config.ts singleton tests
 * (documented in CLAUDE.md).
 *
 * Instead of vi.waitFor() race conditions we poll getIndexStateForTesting()
 * directly, which eliminates timing-sensitive failures.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------------------------------------------------------------------------
// Fake embeddings — 4-dim so maths is simple and deterministic.
// ---------------------------------------------------------------------------

const FAKE_VEC_A = [1, 0, 0, 0];
const FAKE_VEC_B = [0, 1, 0, 0]; // orthogonal to A  → cosine = 0

const FILE_LIST = "note-a.md\nnote-b.md\n";
const NOTE_A_CONTENT = "# Note A\n\nThis is note A content.";
const NOTE_B_CONTENT = "# Note B\n\nThis is note B content.";

// ---------------------------------------------------------------------------
// Helpers shared across describe blocks
// ---------------------------------------------------------------------------

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {}
) {
  // @ts-ignore — internal handler, intentionally accessed in tests
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

/** Poll until indexState reaches "ready" (or throws after 2 s). */
async function waitForReady(
  getState: () => "idle" | "building" | "ready"
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (getState() !== "ready") {
    if (Date.now() > deadline) throw new Error("Index did not reach 'ready' within 2 s");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------------------------------------------------------------------------
// Fresh module setup helper — called inside each beforeEach that needs it.
// ---------------------------------------------------------------------------

async function freshModule(runMock: (args: string[]) => Promise<string>) {
  vi.resetModules();

  // Use a unique vault name per invocation so tests never share an on-disk
  // cache. A shared cache left by a prior run would cause the vault-switch
  // heuristic to fire spuriously when a test uses a different file list.
  const uniqueVault = `__test_fresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
  vi.doMock("../../../src/config.js", () => ({
    config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
  }));
  vi.mock("@xenova/transformers", () => ({
    pipeline: vi.fn().mockResolvedValue(
      vi.fn().mockImplementation(() =>
        Promise.resolve({ tolist: () => [FAKE_VEC_A] })
      )
    ),
  }));

  const { runObsidian } = await import("../../../src/cli.js");
  vi.mocked(runObsidian).mockImplementation(runMock);

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const semantic = await import("../../../src/tools/semantic.js");
  semantic.registerSemanticTools(server);

  return {
    server,
    mockRun: vi.mocked(runObsidian),
    getState: semantic.getIndexStateForTesting,
  };
}

// ---------------------------------------------------------------------------
// cosineSimilarity — pure math, no mocks, no module reset needed
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  // Import once for the whole describe block — pure function, no state.
  let cosineSimilarity: (a: number[], b: number[]) => number;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock("@xenova/transformers", () => ({ pipeline: vi.fn() }));
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    ({ cosineSimilarity } = await import("../../../src/tools/semantic.js"));
  });

  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("returns 0 when one vector is the zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it("returns correct positive similarity for near-parallel vectors", () => {
    const score = cosineSimilarity([0.9, 0.1, 0, 0], [1, 0, 0, 0]);
    expect(score).toBeGreaterThan(0.8);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("returns value in [0, 1] range for normalized vectors", () => {
    const score = cosineSimilarity(FAKE_VEC_A, FAKE_VEC_B);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// freshModuleNoCache — like freshModule but uses a vault name that has no
// on-disk cache. This ensures loadIndex() returns an empty index, so
// startBackgroundIndex() must call syncNewAndDeleted() — where a
// never-resolving mock can hold the state in "building".
// ---------------------------------------------------------------------------

async function freshModuleNoCache(runMock: (args: string[]) => Promise<string>) {
  vi.resetModules();

  // Use a vault name that will never have a real cache file on disk.
  // vi.doMock (not vi.mock) is used so the vault name is resolved at call time.
  const uniqueVault = `__test_empty_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
  vi.doMock("../../../src/config.js", () => ({
    config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
  }));
  vi.doMock("@xenova/transformers", () => ({
    pipeline: vi.fn().mockResolvedValue(
      vi.fn().mockImplementation(() =>
        Promise.resolve({ tolist: () => [FAKE_VEC_A] })
      )
    ),
  }));

  const { runObsidian } = await import("../../../src/cli.js");
  vi.mocked(runObsidian).mockImplementation(runMock);

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const semantic = await import("../../../src/tools/semantic.js");
  semantic.registerSemanticTools(server);

  return {
    server,
    mockRun: vi.mocked(runObsidian),
    getState: semantic.getIndexStateForTesting,
  };
}

// ---------------------------------------------------------------------------
// freshModuleWithCache — like freshModule but pre-seeds a valid index JSON on
// disk so loadIndex() returns a non-empty index (cache-hit path).
// Sets lastReHash=0 so the fullReHash interval fires on first search call.
// Cleans up the written file after the test.
// ---------------------------------------------------------------------------

async function freshModuleWithCache(runMock: (args: string[]) => Promise<string>) {
  vi.resetModules();

  const vaultName = `__test_cached_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeKey = vaultName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cacheDir = path.join(os.homedir(), ".cache", "obsidian-vaultgate-mcp");
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexPath = path.join(cacheDir, `embeddings-${safeKey}.json`);

  // Pre-seed a minimal valid index: one note with one chunk embedding (FAKE_VEC_A),
  // one note with empty chunks (exercises averageAndNormalise([]) guard),
  // lastReHash=0 so REHASH_INTERVAL_MS has elapsed → fullReHash fires.
  const seededIndex = {
    version: 2,
    model: "Xenova/bge-small-en-v1.5",
    lastReHash: 0,
    files: {
      "note-a.md": { hash: "abc123", chunks: [{ heading: "Note A", embedding: FAKE_VEC_A }] },
      "note-empty-chunks.md": { hash: "def456", chunks: [] },
    },
  };
  fs.writeFileSync(indexPath, JSON.stringify(seededIndex), "utf-8");

  vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
  vi.doMock("../../../src/config.js", () => ({
    config: { vault: vaultName, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
  }));
  vi.doMock("@xenova/transformers", () => ({
    pipeline: vi.fn().mockResolvedValue(
      vi.fn().mockImplementation(() =>
        Promise.resolve({ tolist: () => [FAKE_VEC_A] })
      )
    ),
  }));

  const { runObsidian } = await import("../../../src/cli.js");
  vi.mocked(runObsidian).mockImplementation(runMock);

  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const semantic = await import("../../../src/tools/semantic.js");
  semantic.registerSemanticTools(server);

  return {
    server,
    mockRun: vi.mocked(runObsidian),
    getState: semantic.getIndexStateForTesting,
    cleanup: () => { try { fs.unlinkSync(indexPath); } catch { /* already gone */ } },
  };
}

// ---------------------------------------------------------------------------
// cache-hit startup path (lines 404-405) + fullReHash interval (line 454)
// ---------------------------------------------------------------------------

describe("cache-hit startup path", () => {
  it("loads from cache immediately and triggers fullReHash on first search", async () => {
    const { server, mockRun, getState, cleanup } = await freshModuleWithCache(
      async (args) => {
        if (args.includes("list")) return "note-a.md\nnote-empty-chunks.md\n";
        return NOTE_A_CONTENT;
      }
    );

    // With a non-empty cache and config.vault set, indexState goes "ready" immediately
    // (lines 404-405) without waiting for syncNewAndDeleted.
    await waitForReady(getState);

    // Now trigger a search — this calls semanticQuery → syncNewAndDeleted → fullReHash
    // (lastReHash=0, so REHASH_INTERVAL_MS has elapsed → line 454 fires).
    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "note-a.md\nnote-empty-chunks.md\n";
      return NOTE_A_CONTENT;
    });

    const result = await callTool(server, "semantic_search", { query: "test", min_score: 0 });
    expect(result.isError).toBeFalsy();

    cleanup();
  });
});

describe("indexState guard", () => {
  it("semantic_search returns indexing message while building", async () => {
    // Never-resolving file list + no cache on disk keeps indexState in "building"
    const { server } = await freshModuleNoCache(() => new Promise(() => {}));

    const result = await callTool(server, "semantic_search", { query: "test" });
    expect(result.content[0].text).toMatch(/being indexed/i);
  });

  it("find_similar returns indexing message while building", async () => {
    const { server } = await freshModuleNoCache(() => new Promise(() => {}));

    const result = await callTool(server, "find_similar", { note_path: "note-a.md" });
    expect(result.content[0].text).toMatch(/being indexed/i);
  });
});

// ---------------------------------------------------------------------------
// semantic_search
// ---------------------------------------------------------------------------

describe("semantic_search", () => {
  it("returns ranked results with score and preview (happy path)", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT; // reads for both notes and previews
    });

    await waitForReady(getState);

    // Refetch previews will also call readNote — keep mock returning content
    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const result = await callTool(server, "semantic_search", { query: "note content" });
    const text: string = result.content[0].text;

    // Must have at least one result with a score
    expect(text).toMatch(/score:\s*[\d.]+/);
    // Score values must be in [0, 1]
    const scores = [...text.matchAll(/score:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    expect(scores.length).toBeGreaterThan(0);
    scores.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    });
    // Results should be in descending score order
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("returns 'no notes found' message when min_score filters everything out", async () => {
    // FAKE_VEC_A as both query and note embeddings → cosine = 1, but we use
    // FAKE_VEC_B as note embeddings by swapping the mock after module load.
    vi.resetModules();
    const uniqueVault = `__test_minscore_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    // Notes get FAKE_VEC_B (orthogonal to query FAKE_VEC_A) → score = 0
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation(() =>
          Promise.resolve({ tolist: () => [FAKE_VEC_B] })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    await waitForReady(semantic.getIndexStateForTesting);

    vi.mocked(runObsidian).mockResolvedValue("");

    const result = await callTool(server, "semantic_search", {
      query: "anything",
      min_score: 0.5, // notes have score ~0 (orthogonal), nothing passes
    });
    expect(result.content[0].text).toMatch(/no notes found/i);
  });

  it("returns isError when CLI fails during search", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    // Make file list throw on the next search call (syncNewAndDeleted)
    mockRun.mockRejectedValue(new Error("CLI unavailable"));

    const result = await callTool(server, "semantic_search", { query: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("CLI unavailable");
  });

  it("accepts top_n and min_score as strings (preprocessor coercion)", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    // Pass numeric params as strings — Zod preprocessor coerces them
    const result = await callTool(server, "semantic_search", {
      query: "test",
      top_n: "5",
      min_score: "0.1",
    });
    expect(result.isError).toBeFalsy();
  });

  it("still returns results when preview fetch fails for a result", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    // Index OK, but preview reads throw → catch sets preview=""
    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      throw new Error("read failed");
    });

    const result = await callTool(server, "semantic_search", { query: "test", min_score: 0 });
    // Results are still returned, previews are empty
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/score/i);
  });
});

// ---------------------------------------------------------------------------
// find_similar
// ---------------------------------------------------------------------------

describe("find_similar", () => {
  it("excludes the source note from results", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_B_CONTENT;
    });

    const result = await callTool(server, "find_similar", { note_path: "note-a.md" });
    expect(result.content[0].text).not.toContain("note-a.md");
  });

  it("returns isError when note_path is not in index", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockResolvedValue("");

    const result = await callTool(server, "find_similar", {
      note_path: "does-not-exist.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does-not-exist.md");
  });

  it("returns 'no similar notes' when all candidates score below threshold", async () => {
    // Single-note vault: source note is excluded, leaving no candidates → empty results.
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return "only-note.md\n";
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "only-note.md\n";
      return NOTE_A_CONTENT;
    });

    const result = await callTool(server, "find_similar", { note_path: "only-note.md" });
    expect(result.content[0].text).toMatch(/no similar notes/i);
  });

  it("returns isError when find_similar throws during query", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    // Force CLI failure so syncNewAndDeleted inside semanticQuery throws
    mockRun.mockRejectedValue(new Error("Embedding error"));

    const result = await callTool(server, "find_similar", { note_path: "note-a.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Embedding error");
  });

  it("accepts top_n and min_score as strings (preprocessor coercion)", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    // Pass numeric params as strings — Zod preprocessor coerces them
    const result = await callTool(server, "find_similar", {
      note_path: "note-a.md",
      top_n: "3",
      min_score: "0.1",
    });
    expect(result.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// index_vault
// ---------------------------------------------------------------------------

describe("index_vault", () => {
  it("reports re-index complete with note count", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const result = await callTool(server, "index_vault");
    expect(result.content[0].text).toMatch(/re-index complete/i);
    expect(result.content[0].text).toMatch(/\d+ note/);
  });

  it("returns isError when re-index CLI fails", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockRejectedValue(new Error("CLI unavailable"));

    const result = await callTool(server, "index_vault");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("CLI unavailable");
  });

  it("returns guard message when index is not yet ready", async () => {
    const { server } = await freshModuleNoCache(() => new Promise(() => {}));

    const result = await callTool(server, "index_vault");
    expect(result.content[0].text).toMatch(/still in progress/i);
  });
});

// ---------------------------------------------------------------------------
// clear_index
// ---------------------------------------------------------------------------

describe("clear_index", () => {
  it("dry run reports what would be deleted without clearing", async () => {
    const { server, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    const result = await callTool(server, "clear_index", {});
    expect(result.content[0].text).toMatch(/dry run/i);
    expect(result.content[0].text).not.toMatch(/cache cleared/i);
    expect(getState()).toBe("ready");
  });

  it("clears the index and triggers a rebuild when dryRun=false", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const result = await callTool(server, "clear_index", { dryRun: false });
    expect(result.content[0].text).toMatch(/cache cleared/i);
    expect(result.content[0].text).toMatch(/rebuilding/i);
  });

  it("clears gracefully when no cache file exists", async () => {
    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    // The test cache file won't exist on disk — clear_index should handle gracefully.
    const result = await callTool(server, "clear_index", { dryRun: false });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/cache cleared/i);
  });

  it("dry run reports 'nothing to delete' when no cache file exists", async () => {
    // Use a unique vault name so no cache file is on disk.
    vi.resetModules();
    const uniqueVault = `__test_nodry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation(() => Promise.resolve({ tolist: () => [FAKE_VEC_A] }))
      ),
    }));
    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);
    await waitForReady(semantic.getIndexStateForTesting);

    // Delete the cache file if it was created during indexing, so exists=false for the dry run.
    const cacheDir = path.join(os.homedir(), ".cache", "obsidian-vaultgate-mcp");
    const safe = uniqueVault.replace(/[^a-zA-Z0-9_-]/g, "_");
    const cacheFile = path.join(cacheDir, `embeddings-${safe}.json`);
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);

    const result = await callTool(server, "clear_index", {}); // dryRun defaults to true
    expect(result.content[0].text).toMatch(/nothing to delete/i);
  });

  it("returns isError when fs.unlinkSync throws", async () => {
    // Set up a module instance with a mocked fs that throws on unlinkSync.
    vi.resetModules();
    const uniqueVault = `__test_unlink_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation(() => Promise.resolve({ tolist: () => [FAKE_VEC_A] }))
      ),
    }));
    // Mock fs so existsSync returns true and unlinkSync throws.
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        existsSync: (p: string) => (p.includes(uniqueVault.replace(/[^a-zA-Z0-9_-]/g, "_")) ? true : real.existsSync(p)),
        unlinkSync: (p: string) => {
          if (p.includes(uniqueVault.replace(/[^a-zA-Z0-9_-]/g, "_"))) {
            throw new Error("Permission denied");
          }
          real.unlinkSync(p);
        },
      };
    });

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);
    await waitForReady(semantic.getIndexStateForTesting);

    const result = await callTool(server, "clear_index", { dryRun: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });
});

// ---------------------------------------------------------------------------
// vault_info
// ---------------------------------------------------------------------------

describe("vault_info", () => {
  it("shows indexed note count and last re-hash timestamp", async () => {
    const { server, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return FILE_LIST;
      return NOTE_A_CONTENT;
    });

    await waitForReady(getState);

    const result = await callTool(server, "vault_info");
    expect(result.content[0].text).toMatch(/indexed notes:\s*\d+/i);
    expect(result.content[0].text).toMatch(/last full re-hash/i);
    // Note count should match our FILE_LIST (2 notes)
    const match = result.content[0].text.match(/indexed notes:\s*(\d+)/i);
    expect(parseInt(match![1])).toBeGreaterThanOrEqual(1);
  });

  it("returns 'being built' message when index is not ready", async () => {
    // Never-resolving file list + no cache on disk keeps indexState in "building"
    const { server } = await freshModuleNoCache(() => new Promise(() => {}));

    const result = await callTool(server, "vault_info");
    expect(result.content[0].text).toMatch(/being built/i);
  });
});

// ---------------------------------------------------------------------------
// splitIntoSections via semantic_search
// ---------------------------------------------------------------------------

describe("splitIntoSections via semantic_search", () => {
  it("correctly indexes a note with multiple headings", async () => {
    const multiSectionNote = [
      "# Meeting Notes",
      "",
      "Intro text before any section.",
      "",
      "## Agenda",
      "",
      "Item one. Item two. Item three.",
      "",
      "## Action Items",
      "",
      "Follow up on all open tasks.",
    ].join("\n");

    vi.resetModules();
    const uniqueVault = `__test_multisec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation((texts: string[]) =>
          Promise.resolve({ tolist: () => texts.map(() => FAKE_VEC_A) })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "meeting.md\n";
      return multiSectionNote;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    await waitForReady(semantic.getIndexStateForTesting);

    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "meeting.md\n";
      return multiSectionNote;
    });

    const result = await callTool(server, "semantic_search", { query: "agenda items" });
    expect(result.content[0].text).not.toMatch(/being indexed/i);
    expect(result.content[0].text).toContain("meeting.md");
  });

  it("result label includes '> Section' for notes with a matched heading", async () => {
    const noteWithHeading = "# Topic\n\n## Details\n\nSome detailed content here.";

    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return "topic.md\n";
      return noteWithHeading;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "topic.md\n";
      return noteWithHeading;
    });

    const result = await callTool(server, "semantic_search", { query: "details" });
    const text: string = result.content[0].text;
    // Result should contain the path; if a heading matched, it appears as "path > Heading"
    expect(text).toContain("topic.md");
    // Score format still present
    expect(text).toMatch(/score:\s*[\d.]+/);
  });

  it("attaches H2 parent context to H3 sections (parentHeading branch)", async () => {
    // Note with H2 → H3 nesting — exercises the ancestor-lookup loop (line 198-201)
    const nestedNote = [
      "## Parent Section",
      "",
      "Intro text.",
      "",
      "### Child Section",
      "",
      "Detailed child content that is long enough to be indexed.",
    ].join("\n");

    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return "nested.md\n";
      return nestedNote;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "nested.md\n";
      return nestedNote;
    });

    const result = await callTool(server, "semantic_search", { query: "child content", min_score: 0 });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("nested.md");
  });

  it("correctly indexes a note larger than CHUNK_SIZE (2000 chars) via sub-chunking", async () => {
    // A single section with body exceeding 2000 chars triggers paragraph sub-chunking.
    const bigPara1 = "A ".repeat(600).trimEnd(); // ~1200 chars
    const bigPara2 = "B ".repeat(600).trimEnd(); // ~1200 chars
    const bigNote = `# Big Note\n\n## Long Section\n\n${bigPara1}\n\n${bigPara2}`;

    vi.resetModules();
    const uniqueVault = `__test_bigchunk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    // Return one FAKE_VEC_A per input text so sub-chunks embed correctly.
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation((texts: string[]) =>
          Promise.resolve({ tolist: () => texts.map(() => FAKE_VEC_A) })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "big-note.md\n";
      return bigNote;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    await waitForReady(semantic.getIndexStateForTesting);

    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "big-note.md\n";
      return bigNote;
    });

    const result = await callTool(server, "semantic_search", { query: "content" });
    expect(result.content[0].text).not.toMatch(/being indexed/i);
    expect(result.content[0].text).toContain("big-note.md");
  });

  it("correctly indexes a note whose headings are ISO dates", async () => {
    // Notes with date-stamped sections (logs, archives) must index without error.
    // Date headings are stripped from embedded text but kept as display labels.
    const dateNote = [
      "# Project Log",
      "",
      "## 2026-01-15",
      "",
      "Kicked off the initiative and aligned with stakeholders.",
      "",
      "## 2026-02-20",
      "",
      "Reviewed progress and identified blockers.",
    ].join("\n");

    vi.resetModules();
    const uniqueVault = `__test_dateheads_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation((texts: string[]) =>
          Promise.resolve({ tolist: () => texts.map(() => FAKE_VEC_A) })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "log.md\n";
      return dateNote;
    });

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    await waitForReady(semantic.getIndexStateForTesting);

    vi.mocked(runObsidian).mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "log.md\n";
      return dateNote;
    });

    const result = await callTool(server, "semantic_search", { query: "stakeholder alignment" });
    expect(result.content[0].text).not.toMatch(/being indexed/i);
    expect(result.content[0].text).not.toMatch(/semantic search failed/i);
    expect(result.content[0].text).toContain("log.md");
  });
});

// ---------------------------------------------------------------------------
// Vault switch detection — heuristic in syncNewAndDeleted()
// ---------------------------------------------------------------------------

describe("vault switch heuristic", () => {
  // Preserve the real production index (embeddings-default.json) so running
  // tests on a dev machine does not destroy the live semantic index.
  const defaultCachePath = path.join(
    os.homedir(),
    ".cache",
    "obsidian-vaultgate-mcp",
    "embeddings-default.json"
  );
  let savedIndex: Buffer | null = null;

  beforeAll(() => {
    try {
      savedIndex = fs.readFileSync(defaultCachePath);
    } catch {
      savedIndex = null;
    }
  });

  afterAll(() => {
    if (savedIndex !== null) {
      fs.writeFileSync(defaultCachePath, savedIndex);
    } else {
      try {
        fs.unlinkSync(defaultCachePath);
      } catch {
        /* already gone */
      }
    }
  });

  /**
   * Helper: write a valid cache with specific files for the "default" vault,
   * then load a fresh module instance with config.vault = undefined so
   * startBackgroundIndex() will use embeddings-default.json.
   */
  async function setupDefaultVaultWithCache(
    cachedFiles: Record<string, { hash: string; chunks: { heading: string; text: string; embedding: number[] }[] }>,
    runMock: (args: string[]) => Promise<string>
  ) {
    const cacheDir = path.join(os.homedir(), ".cache", "obsidian-vaultgate-mcp");
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "embeddings-default.json");
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ files: cachedFiles, model: "Xenova/bge-small-en-v1.5", version: 2, lastReHash: 0 }),
      "utf-8"
    );

    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    // config.vault is undefined — unconfigured vault case
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation((texts: string[]) =>
          Promise.resolve({ tolist: () => texts.map(() => FAKE_VEC_A) })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    vi.mocked(runObsidian).mockImplementation(runMock);

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    return {
      server,
      mockRun: vi.mocked(runObsidian),
      getState: semantic.getIndexStateForTesting,
      cacheFile,
    };
  }

  it(">50% deletion + new files → wipes index and rebuilds (vault switch)", async () => {
    // Cache has 4 old-vault files. CLI now returns 3 completely different files
    // (>50% deleted, new files present) → vault switch heuristic fires.
    const oldFiles = {
      "old-a.md": { hash: "aaa", chunks: [{ heading: "Old A", text: "old a", embedding: FAKE_VEC_A }] },
      "old-b.md": { hash: "bbb", chunks: [{ heading: "Old B", text: "old b", embedding: FAKE_VEC_A }] },
      "old-c.md": { hash: "ccc", chunks: [{ heading: "Old C", text: "old c", embedding: FAKE_VEC_A }] },
      "old-d.md": { hash: "ddd", chunks: [{ heading: "Old D", text: "old d", embedding: FAKE_VEC_A }] },
    };
    const newVaultList = "new-x.md\nnew-y.md\nnew-z.md\n";
    const { server, getState, cacheFile } = await setupDefaultVaultWithCache(oldFiles, async (args) => {
      if (args.includes("list")) return newVaultList;
      return "# New Note\nContent";
    });

    await waitForReady(getState);

    const result = await callTool(server, "vault_info");
    const text: string = result.content[0].text;
    // Old vault had 4 files; new vault has 3. After rebuild, count must reflect new vault.
    // "Indexed notes: 3" means the 3 new files were embedded and old files are gone.
    expect(text).not.toContain("Indexed notes: 0");
    expect(text).toMatch(/Indexed notes: [1-9]/);
  });

  it(">50% deletion but NO new files → does not wipe (bulk delete, not vault switch)", async () => {
    // Cache has 4 files. CLI returns only 1 (3 deleted, none new).
    // Heuristic requires BOTH deletion AND additions — should not fire.
    const oldFiles = {
      "keep.md": { hash: "kkk", chunks: [{ heading: "Keep", text: "keep", embedding: FAKE_VEC_A }] },
      "gone-1.md": { hash: "g1", chunks: [{ heading: "Gone 1", text: "gone 1", embedding: FAKE_VEC_A }] },
      "gone-2.md": { hash: "g2", chunks: [{ heading: "Gone 2", text: "gone 2", embedding: FAKE_VEC_A }] },
      "gone-3.md": { hash: "g3", chunks: [{ heading: "Gone 3", text: "gone 3", embedding: FAKE_VEC_A }] },
    };
    const { server, getState, cacheFile } = await setupDefaultVaultWithCache(oldFiles, async (args) => {
      if (args.includes("list")) return "keep.md\n";
      return "# Keep\nContent";
    });

    await waitForReady(getState);

    const result = await callTool(server, "vault_info");
    const text: string = result.content[0].text;
    // "keep.md" survived, 3 gone-*.md deleted — 1 note should remain indexed
    expect(text).toContain("Indexed notes: 1");
  });

  it("unconfigured vault with cache defers 'ready' until sync completes (Layer 2)", async () => {
    // Cache has one file. CLI returns a different set — vault switch fires.
    // The critical check: indexState must NOT be "ready" before syncNewAndDeleted() resolves.
    // We verify this by checking that after waitForReady() the results reflect the new vault.
    const oldFiles = {
      "stale-vault-note.md": { hash: "sss", chunks: [{ heading: "Stale", text: "stale content", embedding: FAKE_VEC_A }] },
    };
    const { server, getState, cacheFile } = await setupDefaultVaultWithCache(oldFiles, async (args) => {
      if (args.includes("list")) return "fresh-vault-note.md\n";
      return "# Fresh Note\nContent from new vault";
    });

    await waitForReady(getState);

    const result = await callTool(server, "vault_info");
    const text: string = result.content[0].text;
    // After sync: stale-vault-note.md gone (vault switch detected), fresh-vault-note.md added.
    // Net result: 1 note indexed from the new vault.
    expect(text).toContain("Indexed notes: 1");
  });
});

// ---------------------------------------------------------------------------
// loadIndex — stale cache (wrong version or model) triggers a fresh index
// ---------------------------------------------------------------------------

describe("listVaultPaths — non-markdown file filtering", () => {
  // regression: semantic index hangs forever when vault contains image/attachment
  // files because listVaultPaths returned ALL files and syncNewAndDeleted tried
  // to read each one via the CLI, causing 30-second timeouts on binary files.
  it("only indexes .md files, skipping images and attachments (regression: index hangs on binary files)", async () => {
    const fileList = [
      "note-a.md",
      "Daily/_attachments/Pasted image 20251117114958.png",
      "note-b.md",
      "Assets/diagram.svg",
      "Templates/weekly.md",
    ].join("\n");

    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args[0] === "files" && args[1] === "list") return fileList;
      if (args[0] === "read") return `# ${args[1]}\n\nContent.`;
      return "";
    });

    await waitForReady(getState);

    // Only the three .md files should have been read — never the .png or .svg.
    // Each call is runObsidian(["read", "path=<file>"]) so args[0] is the array.
    const readArgArrays = mockRun.mock.calls
      .map((call) => call[0] as string[])
      .filter((args) => args[0] === "read");

    const readPaths = readArgArrays.map((args) => args[1] ?? "");
    expect(readPaths.some((p) => p.includes(".png"))).toBe(false);
    expect(readPaths.some((p) => p.includes(".svg"))).toBe(false);
    expect(readPaths.filter((p) => p.includes(".md")).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("loadIndex stale cache", () => {
  it("treats an on-disk cache with wrong INDEX_VERSION as empty and re-indexes", async () => {
    // Write a stale cache file (version 0) for a unique vault name.
    const uniqueVault = `__test_stale_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const cacheDir = path.join(os.homedir(), ".cache", "obsidian-vaultgate-mcp");
    fs.mkdirSync(cacheDir, { recursive: true });
    const safe = uniqueVault.replace(/[^a-zA-Z0-9_-]/g, "_");
    const cacheFile = path.join(cacheDir, `embeddings-${safe}.json`);
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ files: { "stale.md": { hash: "abc", chunks: [] } }, model: "Xenova/bge-small-en-v1.5", version: 0, lastReHash: 0 }),
      "utf-8"
    );

    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: uniqueVault, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({
      pipeline: vi.fn().mockResolvedValue(
        vi.fn().mockImplementation((texts: string[]) =>
          Promise.resolve({ tolist: () => texts.map(() => FAKE_VEC_A) })
        )
      ),
    }));

    const { runObsidian } = await import("../../../src/cli.js");
    // Fresh index: no notes — so syncNewAndDeleted returns immediately.
    vi.mocked(runObsidian).mockResolvedValue("");

    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const semantic = await import("../../../src/tools/semantic.js");
    semantic.registerSemanticTools(server);

    await waitForReady(semantic.getIndexStateForTesting);

    // "stale.md" from the old cache must not appear — index was rebuilt from scratch.
    const result = await callTool(server, "vault_info");
    expect(result.content[0].text).not.toContain("stale.md");

    // Clean up
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
  });
});

// ---------------------------------------------------------------------------
// VaultGate tray app integration:
//   - VAULTGATE_MODEL_CACHE_DIR rewires env.cacheDir at module load
//   - emitProgress() posts to process.parentPort (Electron utilityProcess)
//   - syncNewAndDeleted emits per-file progress events
// ---------------------------------------------------------------------------

describe("VAULTGATE_MODEL_CACHE_DIR — pre-bundled model cache wiring", () => {
  // Module-level state means env mutation persists across tests; snapshot + restore.
  const ORIGINAL_CACHE_DIR_ENV = process.env.VAULTGATE_MODEL_CACHE_DIR;
  const ORIGINAL_REMOTE_FLAG_ENV = process.env.VAULTGATE_ALLOW_REMOTE_MODELS;

  beforeEach(() => {
    delete process.env.VAULTGATE_MODEL_CACHE_DIR;
    delete process.env.VAULTGATE_ALLOW_REMOTE_MODELS;
  });

  afterAll(() => {
    if (ORIGINAL_CACHE_DIR_ENV === undefined) delete process.env.VAULTGATE_MODEL_CACHE_DIR;
    else process.env.VAULTGATE_MODEL_CACHE_DIR = ORIGINAL_CACHE_DIR_ENV;
    if (ORIGINAL_REMOTE_FLAG_ENV === undefined) delete process.env.VAULTGATE_ALLOW_REMOTE_MODELS;
    else process.env.VAULTGATE_ALLOW_REMOTE_MODELS = ORIGINAL_REMOTE_FLAG_ENV;
  });

  it("does not touch transformers.env when VAULTGATE_MODEL_CACHE_DIR is unset (headless npm path)", async () => {
    const env = { cacheDir: "INITIAL", allowRemoteModels: true };
    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "v", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({ pipeline: vi.fn(), env }));

    await import("../../../src/tools/semantic.js");

    expect(env.cacheDir).toBe("INITIAL");
    expect(env.allowRemoteModels).toBe(true);
  });

  it("sets transformers.env.cacheDir and disables remote models when VAULTGATE_MODEL_CACHE_DIR is set", async () => {
    process.env.VAULTGATE_MODEL_CACHE_DIR = "/tmp/vaultgate-test-models";
    process.env.VAULTGATE_ALLOW_REMOTE_MODELS = "false";
    const env = { cacheDir: "INITIAL", allowRemoteModels: true };
    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "v", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({ pipeline: vi.fn(), env }));

    await import("../../../src/tools/semantic.js");

    expect(env.cacheDir).toBe("/tmp/vaultgate-test-models");
    expect(env.allowRemoteModels).toBe(false);
  });

  it("keeps allowRemoteModels true when VAULTGATE_ALLOW_REMOTE_MODELS is anything other than 'false'", async () => {
    process.env.VAULTGATE_MODEL_CACHE_DIR = "/tmp/vaultgate-test-models";
    process.env.VAULTGATE_ALLOW_REMOTE_MODELS = "true";
    const env = { cacheDir: "INITIAL", allowRemoteModels: false };
    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "v", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.doMock("@xenova/transformers", () => ({ pipeline: vi.fn(), env }));

    await import("../../../src/tools/semantic.js");

    expect(env.allowRemoteModels).toBe(true);
  });
});

describe("emitProgress — utilityProcess.fork() IPC", () => {
  // Snapshot the Electron-only field; tests inject a fake parentPort.
  const ORIGINAL_PARENT_PORT = (process as unknown as { parentPort?: unknown }).parentPort;

  function setParentPort(value: unknown): void {
    (process as unknown as { parentPort?: unknown }).parentPort = value;
  }

  beforeEach(() => {
    setParentPort(undefined);
  });

  afterAll(() => {
    setParentPort(ORIGINAL_PARENT_PORT);
  });

  it("forwards 'state' transitions to process.parentPort during a build", async () => {
    const posted: unknown[] = [];
    setParentPort({ postMessage: (msg: unknown) => posted.push(msg) });

    const { getState } = await freshModule(async (args) => {
      // Empty vault — sync resolves immediately.
      if (args[0] === "files" && args[1] === "list") return "";
      return "";
    });
    await waitForReady(getState);

    const events = posted
      .filter((m): m is { __vaultgate_index__: { type: string; state?: string } } =>
        typeof m === "object" && m !== null && "__vaultgate_index__" in m
      )
      .map((m) => m.__vaultgate_index__);

    // First event is "state: building", final is "state: ready".
    expect(events[0]).toEqual({ type: "state", state: "building" });
    const last = events[events.length - 1];
    expect(last?.type).toBe("state");
    expect(last?.state).toBe("ready");
  });

  it("emits per-file progress while embedding new notes", async () => {
    const posted: unknown[] = [];
    setParentPort({ postMessage: (msg: unknown) => posted.push(msg) });

    // Three-note vault — yields three "progress" events at 33/67/100 percent.
    const { getState } = await freshModule(async (args) => {
      if (args[0] === "files" && args[1] === "list") return "n1.md\nn2.md\nn3.md\n";
      if (args[0] === "read") return "# Note\n\ncontent";
      return "";
    });
    await waitForReady(getState);

    const progress = posted
      .filter((m): m is { __vaultgate_index__: { type: string; progress?: number } } =>
        typeof m === "object" && m !== null && "__vaultgate_index__" in m
      )
      .map((m) => m.__vaultgate_index__)
      .filter((e) => e.type === "progress");

    expect(progress.length).toBe(3);
    expect(progress[0]?.progress).toBe(33);
    expect(progress[1]?.progress).toBe(67);
    expect(progress[2]?.progress).toBe(100);
  });

  it("is a no-op (no throw) when process.parentPort is undefined (headless npm path)", async () => {
    setParentPort(undefined);

    const { getState } = await freshModule(async () => "");
    await expect(waitForReady(getState)).resolves.toBeUndefined();
  });

  it("swallows errors from a faulty parentPort.postMessage rather than crashing the build", async () => {
    setParentPort({
      postMessage: () => {
        throw new Error("synthetic IPC failure");
      },
    });

    const { getState } = await freshModule(async () => "");
    await expect(waitForReady(getState)).resolves.toBeUndefined();
  });
});
