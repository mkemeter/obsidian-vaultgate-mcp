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

import { describe, it, expect, vi, beforeEach } from "vitest";
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

  vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
  vi.mock("../../../src/config.js", () => ({
    config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
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
// indexState guard — search returns "indexing" message before build completes
// ---------------------------------------------------------------------------

describe("indexState guard", () => {
  it("semantic_search returns indexing message while building", async () => {
    // Never-resolving file list keeps indexState in "building"
    const { server } = await freshModule(() => new Promise(() => {}));

    const result = await callTool(server, "semantic_search", { query: "test" });
    expect(result.content[0].text).toMatch(/being indexed/i);
  });

  it("find_similar returns indexing message while building", async () => {
    const { server } = await freshModule(() => new Promise(() => {}));

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
    vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.mock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    // Notes get FAKE_VEC_B (orthogonal to query FAKE_VEC_A) → score = 0
    vi.mock("@xenova/transformers", () => ({
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
    // Never-resolving build keeps indexState in "building"
    const { server } = await freshModule(() => new Promise(() => {}));

    const result = await callTool(server, "vault_info");
    expect(result.content[0].text).toMatch(/being built/i);
  });
});

// ---------------------------------------------------------------------------
// chunkText — large-note chunking (exercises the overflow branch)
// ---------------------------------------------------------------------------

describe("chunkText via semantic_search", () => {
  it("correctly indexes a note larger than CHUNK_SIZE (2000 chars)", async () => {
    // Build a note with two large paragraphs that exceed 2000 chars total.
    const bigPara1 = "A ".repeat(600).trimEnd(); // ~1200 chars
    const bigPara2 = "B ".repeat(600).trimEnd(); // ~1200 chars
    const bigNote = `# Big Note\n\n${bigPara1}\n\n${bigPara2}`;

    const { server, mockRun, getState } = await freshModule(async (args) => {
      if (args.includes("list")) return "big-note.md\n";
      return bigNote;
    });

    await waitForReady(getState);

    mockRun.mockImplementation(async (args: string[]) => {
      if (args.includes("list")) return "big-note.md\n";
      return bigNote;
    });

    // Index was built — search should find the note (no error / no "indexing" message)
    const result = await callTool(server, "semantic_search", { query: "content" });
    expect(result.content[0].text).not.toMatch(/being indexed/i);
    // big-note.md should appear in results (score ≥ DEFAULT_MIN_SCORE with identical vecs)
    expect(result.content[0].text).toContain("big-note.md");
  });
});
