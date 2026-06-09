/**
 * Semantic search tools for obsidian-mcp-http.
 *
 * Requires @xenova/transformers (optional dependency). If the package is
 * unavailable this module will fail to import and server.ts silently skips it.
 *
 * Four tools are registered:
 *   semantic_search — natural-language query → ranked note results
 *   find_similar    — given a vault path → similar notes
 *   index_vault     — force full re-index (escape hatch)
 *   vault_info      — note count + last indexed timestamp
 *
 * The embedding index is maintained automatically:
 *   - Built in the background at server startup.
 *   - New / deleted notes detected instantly on each search call (path diff).
 *   - Modified notes detected lazily: full re-hash triggered async if last
 *     re-hash was more than 24 h ago.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as os from "node:os";
import { pipeline } from "@xenova/transformers";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runObsidian } from "../cli.js";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

interface IndexEntry {
  hash: string;
  embedding: number[];
}

interface VaultIndex {
  files: Record<string, IndexEntry>;
  model: string;
  version: number;
  lastReHash: number;
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// (shared across all createServer() calls via Node.js module cache)
// ---------------------------------------------------------------------------

let indexState: "idle" | "building" | "ready" = "idle";
let isReHashing = false;
let embedderInstance: Awaited<ReturnType<typeof pipeline>> | null = null;

const MODEL_ID = "Xenova/bge-small-en-v1.5";
const INDEX_VERSION = 1;
const CHUNK_SIZE = 2000;
const REHASH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_SCORE = 0.25;

// ---------------------------------------------------------------------------
// Index path helpers
// ---------------------------------------------------------------------------

function getIndexPath(): string {
  const vaultKey = config.vault ?? "default";
  const safe = vaultKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(os.homedir(), ".cache", "obsidian-mcp-http");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `embeddings-${safe}.json`);
}

function loadIndex(): VaultIndex {
  const p = getIndexPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as VaultIndex;
    if (parsed.version !== INDEX_VERSION || parsed.model !== MODEL_ID) {
      return { files: {}, model: MODEL_ID, version: INDEX_VERSION, lastReHash: 0 };
    }
    return parsed;
  } catch {
    return { files: {}, model: MODEL_ID, version: INDEX_VERSION, lastReHash: 0 };
  }
}

function saveIndex(idx: VaultIndex): void {
  try {
    fs.writeFileSync(getIndexPath(), JSON.stringify(idx), "utf-8");
  } catch {
    // Non-fatal — in-memory index stays valid even if we can't persist.
  }
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function getEmbedder(): Promise<Awaited<ReturnType<typeof pipeline>>> {
  if (!embedderInstance) {
    embedderInstance = await pipeline("feature-extraction", MODEL_ID);
  }
  return embedderInstance;
}

async function embed(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  // output.tolist() returns number[][]
  return (output as { tolist(): number[][] }).tolist();
}

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

function cleanNote(content: string): string {
  // Strip YAML frontmatter
  let cleaned = content.replace(/^---[\s\S]*?---\n?/, "");
  // Strip fenced code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  // Strip Obsidian embedded file links ![[...]]
  cleaned = cleaned.replace(/!\[\[.*?\]\]/g, "");
  return cleaned.trim();
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, CHUNK_SIZE)];
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function averageAndNormalise(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const avg = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) avg[i] += v[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= vectors.length;
  // L2 normalise
  const norm = Math.sqrt(avg.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? avg : avg.map((x) => x / norm);
}

// ---------------------------------------------------------------------------
// CLI helpers — get vault file paths and content via Obsidian CLI
// ---------------------------------------------------------------------------

async function listVaultPaths(): Promise<string[]> {
  const result = await runObsidian(["files", "list"]);
  return result
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function readNote(filePath: string): Promise<string> {
  return runObsidian(["files", "read", "--file", filePath]);
}

// ---------------------------------------------------------------------------
// Per-note embedding — chunk, embed, average
// ---------------------------------------------------------------------------

async function embedNote(content: string): Promise<number[]> {
  const cleaned = cleanNote(content);
  if (!cleaned) return [];
  const chunks = chunkText(cleaned);
  const vectors = await embed(chunks);
  return averageAndNormalise(vectors);
}

// ---------------------------------------------------------------------------
// Index sync helpers
// ---------------------------------------------------------------------------

async function syncNewAndDeleted(idx: VaultIndex): Promise<void> {
  const paths = await listVaultPaths();
  const pathSet = new Set(paths);

  // Prune deleted
  for (const p of Object.keys(idx.files)) {
    if (!pathSet.has(p)) delete idx.files[p];
  }

  // Embed new (no hash yet)
  const newPaths = paths.filter((p) => !(p in idx.files));
  for (const p of newPaths) {
    try {
      const content = await readNote(p);
      const hash = md5(content);
      const embedding = await embedNote(content);
      if (embedding.length > 0) {
        idx.files[p] = { hash, embedding };
      }
    } catch {
      // Skip notes that can't be read — non-fatal.
    }
  }
}

async function fullReHash(idx: VaultIndex): Promise<void> {
  if (isReHashing) return;
  isReHashing = true;
  try {
    const paths = await listVaultPaths();
    const pathSet = new Set(paths);

    // Prune deleted
    for (const p of Object.keys(idx.files)) {
      if (!pathSet.has(p)) delete idx.files[p];
    }

    // Re-embed changed files
    for (const p of paths) {
      try {
        const content = await readNote(p);
        const hash = md5(content);
        if (idx.files[p]?.hash !== hash) {
          const embedding = await embedNote(content);
          if (embedding.length > 0) {
            idx.files[p] = { hash, embedding };
          }
        }
      } catch {
        // Non-fatal.
      }
    }

    idx.lastReHash = Date.now();
    saveIndex(idx);
  } finally {
    isReHashing = false;
  }
}

// ---------------------------------------------------------------------------
// Background index build
// ---------------------------------------------------------------------------

// Module-level index reference — kept in memory so searches don't re-load from disk.
let liveIndex: VaultIndex | null = null;

/** Exported only for testing — returns the current index build state. */
export function getIndexStateForTesting(): "idle" | "building" | "ready" {
  return indexState;
}

function startBackgroundIndex(): void {
  if (indexState !== "idle") return; // singleton guard
  indexState = "building";

  (async () => {
    try {
      const idx = loadIndex();
      await syncNewAndDeleted(idx);
      idx.lastReHash = Date.now();
      saveIndex(idx);
      liveIndex = idx;
      indexState = "ready";
    } catch {
      // If build fails, stay in "building" so callers return the "indexing" message
      // rather than crashing. A server restart will retry.
    }
  })();
}

// ---------------------------------------------------------------------------
// Search logic
// ---------------------------------------------------------------------------

interface SearchResult {
  path: string;
  score: number;
  preview: string;
}

async function semanticQuery(
  queryVec: number[],
  topN: number,
  minScore: number,
  excludePath?: string
): Promise<SearchResult[]> {
  if (!liveIndex) return [];

  // Path-level sync — instant detection of new/deleted notes.
  await syncNewAndDeleted(liveIndex);

  // Lazy re-hash — detect modified notes, triggered at most once per 24 h.
  if (
    !isReHashing &&
    Date.now() - (liveIndex.lastReHash ?? 0) > REHASH_INTERVAL_MS
  ) {
    fullReHash(liveIndex).catch(() => {}); // fire-and-forget
  }

  const results: SearchResult[] = [];
  for (const [p, entry] of Object.entries(liveIndex.files)) {
    if (p === excludePath) continue;
    const score = cosineSimilarity(queryVec, entry.embedding);
    if (score >= minScore) {
      results.push({ path: p, score, preview: "" });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, topN);

  // Fetch previews for top results.
  for (const r of top) {
    try {
      const content = await readNote(r.path);
      r.preview = cleanNote(content).slice(0, 300).replace(/\n+/g, " ").trim();
    } catch {
      r.preview = "";
    }
  }

  saveIndex(liveIndex);
  return top;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSemanticTools(server: McpServer): void {
  startBackgroundIndex();

  // --- semantic_search ---------------------------------------------------
  server.tool(
    "semantic_search",
    "Search your Obsidian vault by meaning, not just keywords. Returns ranked notes with short previews.",
    {
      query: z.string().describe("Natural-language search query"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(DEFAULT_TOP_N)
        .describe("Maximum number of results to return (default 10)"),
      min_score: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_MIN_SCORE)
        .describe(
          "Minimum similarity score 0–1 to include a result (default 0.25)"
        ),
    },
    async ({ query, top_n, min_score }) => {
      if (indexState !== "ready") {
        return {
          content: [
            {
              type: "text",
              text: "Your vault is being indexed for the first time. Please try again in a moment.",
            },
          ],
        };
      }

      try {
        const [queryVec] = await embed([query]);
        const results = await semanticQuery(queryVec, top_n, min_score);

        if (results.length === 0) {
          return {
            content: [
              { type: "text", text: "No notes found matching your query." },
            ],
          };
        }

        const lines = results.map(
          (r, i) =>
            `${i + 1}. ${r.path} (score: ${r.score.toFixed(3)})\n   ${r.preview}`
        );
        return {
          content: [{ type: "text", text: lines.join("\n\n") }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Semantic search failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  // --- find_similar -------------------------------------------------------
  server.tool(
    "find_similar",
    "Find notes semantically similar to a given note. Useful for discovering related content.",
    {
      note_path: z
        .string()
        .describe(
          "Vault-relative path of the source note (as returned by files_list or semantic_search)"
        ),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(DEFAULT_TOP_N)
        .describe("Maximum number of results to return (default 10)"),
      min_score: z
        .number()
        .min(0)
        .max(1)
        .default(DEFAULT_MIN_SCORE)
        .describe("Minimum similarity score 0–1 (default 0.25)"),
    },
    async ({ note_path, top_n, min_score }) => {
      if (indexState !== "ready") {
        return {
          content: [
            {
              type: "text",
              text: "Your vault is being indexed for the first time. Please try again in a moment.",
            },
          ],
        };
      }

      try {
        const entry = liveIndex?.files[note_path];
        if (!entry) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Note not found in index: ${note_path}. It may not exist or has not been indexed yet.`,
              },
            ],
          };
        }

        const results = await semanticQuery(
          entry.embedding,
          top_n,
          min_score,
          note_path // exclude source note
        );

        if (results.length === 0) {
          return {
            content: [
              { type: "text", text: "No similar notes found." },
            ],
          };
        }

        const lines = results.map(
          (r, i) =>
            `${i + 1}. ${r.path} (score: ${r.score.toFixed(3)})\n   ${r.preview}`
        );
        return {
          content: [{ type: "text", text: lines.join("\n\n") }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `find_similar failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  // --- index_vault --------------------------------------------------------
  server.tool(
    "index_vault",
    "Force a full re-index of the vault. Normally not needed — the index is maintained automatically. Use only if you suspect the index is stale.",
    {},
    async () => {
      if (!liveIndex) {
        return {
          content: [
            {
              type: "text",
              text: "Initial indexing is still in progress. Please try again in a moment.",
            },
          ],
        };
      }

      try {
        await fullReHash(liveIndex);
        const count = Object.keys(liveIndex.files).length;
        return {
          content: [
            {
              type: "text",
              text: `Re-index complete. ${count} note${count === 1 ? "" : "s"} indexed.`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Re-index failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  // --- vault_info ---------------------------------------------------------
  server.tool(
    "vault_info",
    "Show the number of indexed notes and when the index was last updated.",
    {},
    async () => {
      if (!liveIndex || indexState !== "ready") {
        return {
          content: [
            {
              type: "text",
              text: "Vault index is being built. Please try again in a moment.",
            },
          ],
        };
      }

      const count = Object.keys(liveIndex.files).length;
      const ts = liveIndex.lastReHash
        ? new Date(liveIndex.lastReHash).toLocaleString()
        : "unknown";

      return {
        content: [
          {
            type: "text",
            text: `Indexed notes: ${count}\nLast full re-hash: ${ts}`,
          },
        ],
      };
    }
  );
}
