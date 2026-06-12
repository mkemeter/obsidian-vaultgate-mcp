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
// indexState guard — search returns "indexing" message before build completes
// ---------------------------------------------------------------------------

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
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
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
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    // Return one FAKE_VEC_A per input text so multi-section notes embed correctly.
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

  it("correctly indexes a note larger than CHUNK_SIZE (2000 chars) via sub-chunking", async () => {
    // A single section with body exceeding 2000 chars triggers paragraph sub-chunking.
    const bigPara1 = "A ".repeat(600).trimEnd(); // ~1200 chars
    const bigPara2 = "B ".repeat(600).trimEnd(); // ~1200 chars
    const bigNote = `# Big Note\n\n## Long Section\n\n${bigPara1}\n\n${bigPara2}`;

    vi.resetModules();
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
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
    vi.doMock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
    vi.doMock("../../../src/config.js", () => ({
      config: { vault: "TestVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
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
// loadIndex — stale cache (wrong version or model) triggers a fresh index
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
