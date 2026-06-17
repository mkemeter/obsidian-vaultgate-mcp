/**
 * Semantic search tools for obsidian-vaultgate-mcp.
 *
 * Requires @xenova/transformers (optional dependency). If the package is
 * unavailable this module will fail to import and server.ts silently skips it.
 *
 * Five tools are registered:
 *   semantic_search — natural-language query → ranked note results with section labels
 *   find_similar    — given a vault path → similar notes
 *   index_vault     — force full re-index (escape hatch)
 *   clear_index     — delete cache and rebuild from scratch (last-resort reset)
 *   vault_info      — note count + last indexed timestamp
 *
 * The embedding index is maintained automatically:
 *   - Built in the background at server startup (cache-first):
 *     - Configured vault (OBSIDIAN_VAULT set): cache becomes ready immediately;
 *       syncNewAndDeleted() runs on the first search call.
 *     - Unconfigured vault: cache loads, but syncNewAndDeleted() runs immediately
 *       at startup before "ready" — guards against cross-session vault switches
 *       (shared embeddings-default.json).
 *   - New / deleted notes detected on each search call (path diff).
 *   - Vault switch detected heuristically: if >50% of indexed paths disappear AND
 *     new paths arrive in the same sync, the index is wiped and rebuilt from scratch.
 *   - Modified notes detected lazily: full re-hash triggered async if last
 *     re-hash was more than 24 h ago.
 *
 * Indexing strategy: one embedding per section (H1/H2/H3 boundary). Search
 * scores notes by their best-matching chunk (max pooling). Results include the
 * matched section heading so users know which part of a note to open.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as transformers from "@xenova/transformers";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { config } from "../config.js";
import { dryRunSchema } from "./_helpers.js";

const { pipeline } = transformers;

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

interface ChunkEntry {
  heading: string;
  embedding: number[];
}

interface IndexEntry {
  hash: string;
  chunks: ChunkEntry[];
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
const INDEX_VERSION = 2;
const CHUNK_SIZE = 2000;
const REHASH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
const DEFAULT_TOP_N = 10;
const DEFAULT_MIN_SCORE = 0.25;

// ---------------------------------------------------------------------------
// Pre-bundled model cache (used by the VaultGate tray app)
// ---------------------------------------------------------------------------
// When `VAULTGATE_MODEL_CACHE_DIR` is set the server points @xenova/transformers
// at a pre-populated HuggingFace snapshot directory shipped inside the Electron
// app bundle, and disables remote downloads. The headless npm path leaves these
// unset and `@xenova/transformers` uses its default download behaviour.
//
// The `env` namespace is resolved lazily — eager access at module top-level
// would trip vitest's mock proxy in the unit tests (which only mocks `pipeline`).
if (process.env.VAULTGATE_MODEL_CACHE_DIR) {
  const transformersEnv = (
    transformers as unknown as {
      env: { cacheDir: string; allowRemoteModels: boolean };
    }
  ).env;
  if (transformersEnv) {
    transformersEnv.cacheDir = process.env.VAULTGATE_MODEL_CACHE_DIR;
    transformersEnv.allowRemoteModels = process.env.VAULTGATE_ALLOW_REMOTE_MODELS !== "false";
  }
}

// ---------------------------------------------------------------------------
// Indexing-progress IPC (for the VaultGate tray app)
// ---------------------------------------------------------------------------

/** Progress event mirrored to the parent process when running under Electron. */
interface IndexProgressEvent {
  type: "state" | "progress" | "complete" | "error";
  state?: "idle" | "building" | "ready" | "error";
  progress?: number;
  filesProcessed?: number;
  totalFiles?: number;
  error?: string;
}

/**
 * Posts an indexing progress event to the parent process. No-op outside of
 * Electron `utilityProcess.fork()` (the headless npm path).
 *
 * Electron's utility processes use MessagePort-based IPC, NOT the Node.js
 * `process.send()` channel — `process.parentPort` is `undefined` in plain Node.
 */
function emitProgress(event: IndexProgressEvent): void {
  try {
    // `process.parentPort` is Electron-only; cast to satisfy the Node typings.
    const parentPort = (process as unknown as { parentPort?: { postMessage(msg: unknown): void } })
      .parentPort;
    if (parentPort) {
      parentPort.postMessage({ __vaultgate_index__: event });
    }
  } catch {
    /* no-op */
  }
}

// ---------------------------------------------------------------------------
// Index path helpers
// ---------------------------------------------------------------------------

function getIndexPath(): string {
  const vaultKey = config.vault ?? "default";
  const safe = vaultKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(os.homedir(), ".cache", "obsidian-vaultgate-mcp");
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
    console.error(
      `[VaultGate] Loading semantic model ${MODEL_ID} — first run may take several minutes while the model is compiled for your CPU...`
    );
    const t0 = Date.now();
    embedderInstance = await pipeline("feature-extraction", MODEL_ID);
    console.error(
      `[VaultGate] Semantic model ready (loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
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

// Matches ISO date-only headings like "## 2026-01-20" — these carry temporal
// structure but not semantic content, so we exclude them from embedded text
// while keeping them as display labels.
const DATE_HEADING_RE = /^\d{4}-\d{2}-\d{2}\s*$/;

function isDateOnlyHeading(heading: string): boolean {
  return DATE_HEADING_RE.test(heading.replace(/^#+\s*/, "").trim());
}

function splitIntoSections(text: string): Array<{ heading: string; text: string }> {
  const lines = text.split("\n");
  const headingRe = /^#{1,3}\s+(.+)/;

  // Find the H1 title for use as context prefix in sub-sections.
  const titleLine = lines.find((l) => /^#\s+/.test(l));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : "";

  // Pass 1: split into raw sections.
  const rawSections: Array<{ heading: string; body: string }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (headingRe.test(line)) {
      rawSections.push({ heading: currentHeading, body: currentLines.join("\n").trim() });
      currentHeading = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  rawSections.push({ heading: currentHeading, body: currentLines.join("\n").trim() });

  // Pass 2: attach nearest H1/H2 parent to each H3 section.
  const sections = rawSections.map((section, i) => {
    if (/^###\s/.test(section.heading)) {
      for (let j = i - 1; j >= 0; j--) {
        const ancestor = rawSections[j];
        if (ancestor && /^#{1,2}\s/.test(ancestor.heading)) {
          return { ...section, parentHeading: ancestor.heading };
        }
      }
    }
    return { ...section, parentHeading: "" };
  });

  const result: Array<{ heading: string; text: string }> = [];

  for (const { heading, parentHeading, body } of sections) {
    if (`${heading}\n\n${body}`.trim().length < 20) continue;

    // Build embedding text:
    //   - Always start with document title
    //   - For H3 sections: include parent H2 (skip if it is a date heading)
    //   - Include current heading (skip if it is a date heading)
    //   - Always include body
    const parts: string[] = [];
    if (title) parts.push(title);
    if (parentHeading && !isDateOnlyHeading(parentHeading)) parts.push(parentHeading);
    if (heading && !isDateOnlyHeading(heading)) parts.push(heading);
    parts.push(body);

    const fullText = parts.filter(Boolean).join("\n\n").trim();
    if (fullText.length < 20) continue;

    if (fullText.length <= CHUNK_SIZE) {
      result.push({ heading, text: fullText });
    } else {
      for (const sub of chunkText(fullText)) {
        result.push({ heading, text: sub });
      }
    }
  }

  return result.length > 0 ? result : [{ heading: "", text: text.slice(0, CHUNK_SIZE) }];
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
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function averageAndNormalise(vectors: number[][]): number[] {
  const first = vectors[0];
  if (!first) return [];
  const dim = first.length;
  const avg = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) + (v[i] ?? 0);
  }
  for (let i = 0; i < dim; i++) avg[i] = (avg[i] ?? 0) / vectors.length;
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
    .filter((l) => l.endsWith(".md"));
}

async function readNote(filePath: string): Promise<string> {
  return runObsidian(["read", `path=${filePath}`]);
}

// ---------------------------------------------------------------------------
// Per-note embedding — chunk, embed, average
// ---------------------------------------------------------------------------

async function embedNote(content: string): Promise<ChunkEntry[]> {
  const cleaned = cleanNote(content);
  if (!cleaned) return [];
  const sections = splitIntoSections(cleaned);
  // Process sections in small batches to avoid overwhelming the ONNX runtime
  // with a single large TypedArray allocation (which can trigger V8 heap assertions).
  const BATCH = 8;
  const chunks: ChunkEntry[] = [];
  for (let i = 0; i < sections.length; i += BATCH) {
    const batch = sections.slice(i, i + BATCH);
    const vectors = await embed(batch.map((s) => s.text));
    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      if (s) chunks.push({ heading: s.heading, embedding: vectors[j] ?? [] });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Index sync helpers
// ---------------------------------------------------------------------------

async function syncNewAndDeleted(idx: VaultIndex): Promise<void> {
  const paths = await listVaultPaths();
  const pathSet = new Set(paths);

  // Vault switch heuristic: if >50% of indexed files are absent AND there are
  // incoming new paths, assume the user switched vaults rather than deleted
  // a large portion of the current vault. Wipe the index so stale embeddings
  // from the previous vault are not mixed with fresh ones.
  const previousTotal = Object.keys(idx.files).length;
  const deletedCount = Object.keys(idx.files).filter((p) => !pathSet.has(p)).length;
  const newPaths = paths.filter((p) => !(p in idx.files));
  if (previousTotal > 0 && deletedCount / previousTotal > 0.5 && newPaths.length > 0) {
    console.error("[VaultGate] Vault switch detected — rebuilding semantic index from scratch.");
    idx.files = {};
  }

  // Prune deleted
  for (const p of Object.keys(idx.files)) {
    if (!pathSet.has(p)) delete idx.files[p];
  }

  // Embed new (no hash yet)
  const freshNewPaths = paths.filter((p) => !(p in idx.files));
  const total = freshNewPaths.length;
  if (total > 0) {
    console.error(`[VaultGate] Embedding ${total} note(s) — loading model on first run...`);
  }
  let processed = 0;
  for (const p of freshNewPaths) {
    // Yield to the event loop between notes so V8 GC can reclaim ONNX-allocated
    // TypedArrays before the next inference run. Without this, rapid successive
    // allocations can corrupt the V8 heap and trigger a SIGTRAP fatal assertion.
    await new Promise<void>((r) => setTimeout(r, 0));
    console.error(`[VaultGate] embedding: ${p}`);
    try {
      const content = await readNote(p);
      const hash = md5(content);
      const chunks = await embedNote(content);
      if (chunks.length > 0) {
        idx.files[p] = { hash, chunks };
      }
    } catch {
      // Skip notes that can't be read — non-fatal.
    }
    processed += 1;
    // Checkpoint every 50 notes: flush to disk so a crash mid-build preserves
    // progress and keeps peak heap usage bounded.
    if (processed % 50 === 0) saveIndex(idx);
    if (total > 0) {
      emitProgress({
        type: "progress",
        progress: Math.round((processed / total) * 100),
        filesProcessed: processed,
        totalFiles: total,
      });
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
          const chunks = await embedNote(content);
          if (chunks.length > 0) {
            idx.files[p] = { hash, chunks };
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
  emitProgress({ type: "state", state: "building" });

  (async () => {
    try {
      const idx = loadIndex();

      if (Object.keys(idx.files).length > 0) {
        if (config.vault) {
          // Configured vault: every CLI call is scoped to that vault by name,
          // so the cache is always correct. Become ready immediately.
          liveIndex = idx;
          indexState = "ready";
        } else {
          // No configured vault: the cache key is "default" and is shared
          // across all vaults the user may have open. Run syncNewAndDeleted()
          // now to detect a cross-session vault switch before serving results.
          liveIndex = idx;
          await syncNewAndDeleted(idx);
          saveIndex(idx);
          indexState = "ready";
        }
      } else {
        // No cache yet: embed all notes before becoming ready.
        await syncNewAndDeleted(idx);
        idx.lastReHash = Date.now();
        saveIndex(idx);
        liveIndex = idx;
        indexState = "ready";
      }
      emitProgress({
        type: "state",
        state: "ready",
        filesProcessed: Object.keys(idx.files).length,
      });
    } catch (err) {
      // If build fails, stay in "building" so callers return the "indexing" message
      // rather than crashing. A server restart will retry.
      emitProgress({
        type: "error",
        error: err instanceof Error ? err.message : String(err),
      });
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
  matchedHeading: string;
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
  if (!isReHashing && Date.now() - (liveIndex.lastReHash ?? 0) > REHASH_INTERVAL_MS) {
    fullReHash(liveIndex).catch(() => {}); // fire-and-forget
  }

  const results: SearchResult[] = [];
  for (const [p, entry] of Object.entries(liveIndex.files)) {
    if (p === excludePath) continue;
    let bestScore = 0;
    let bestHeading = "";
    for (const chunk of entry.chunks) {
      const s = cosineSimilarity(queryVec, chunk.embedding);
      if (s > bestScore) {
        bestScore = s;
        bestHeading = chunk.heading;
      }
    }
    if (bestScore >= minScore) {
      results.push({ path: p, score: bestScore, preview: "", matchedHeading: bestHeading });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, topN);

  // Fetch previews for top results.
  for (const r of top) {
    try {
      const content = await readNote(r.path);
      const cleaned = cleanNote(content).replace(/\n+/g, " ").trim();
      r.preview = cleaned.length > 300 ? `${cleaned.slice(0, 297)}...` : cleaned;
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
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(50))
        .default(DEFAULT_TOP_N)
        .describe("Maximum number of results to return (default 10)"),
      min_score: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(0).max(1))
        .default(DEFAULT_MIN_SCORE)
        .describe("Minimum similarity score 0–1 to include a result (default 0.25)"),
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
        const embeddings = await embed([query]);
        const queryVec = embeddings[0];
        if (!queryVec) throw new Error("Embedding returned no vector");
        const results = await semanticQuery(queryVec, top_n, min_score);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No notes found matching your query." }],
          };
        }

        const lines = results.map((r, i) => {
          const label = r.matchedHeading
            ? `${r.path} > ${r.matchedHeading.replace(/^#+\s*/, "").trim()}`
            : r.path;
          return `${i + 1}. ${label} (score: ${r.score.toFixed(3)})\n   ${r.preview}`;
        });
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
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(50))
        .default(DEFAULT_TOP_N)
        .describe("Maximum number of results to return (default 10)"),
      min_score: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(0).max(1))
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

        const noteVec = averageAndNormalise(entry.chunks.map((c) => c.embedding));
        const results = await semanticQuery(
          noteVec,
          top_n,
          min_score,
          note_path // exclude source note
        );

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No similar notes found." }],
          };
        }

        const lines = results.map((r, i) => {
          const label = r.matchedHeading
            ? `${r.path} > ${r.matchedHeading.replace(/^#+\s*/, "").trim()}`
            : r.path;
          return `${i + 1}. ${label} (score: ${r.score.toFixed(3)})\n   ${r.preview}`;
        });
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
      if (!liveIndex || indexState !== "ready") {
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

  // --- clear_index --------------------------------------------------------
  server.tool(
    "clear_index",
    [
      "Delete the local embedding cache file and rebuild the index from scratch.",
      "Use this only when the cache is corrupted or after a version/model change that",
      "leaves stale data on disk.",
      "DO NOT use this before re-indexing — index_vault already re-embeds changed notes",
      "without discarding anything. clear_index is a last-resort reset, not a routine operation.",
      "A background rebuild starts automatically after clearing; searches will return",
      "'being indexed' until it completes.",
    ].join(" "),
    {
      dryRun: dryRunSchema,
    },
    async ({ dryRun }) => {
      const cachePath = getIndexPath();
      const exists = fs.existsSync(cachePath);

      if (dryRun) {
        return {
          content: [
            {
              type: "text",
              text: exists
                ? `Dry run: would delete cache file at ${cachePath} and trigger a full rebuild.\nPass dryRun=false to proceed.`
                : `Dry run: no cache file found at ${cachePath} — nothing to delete.`,
            },
          ],
        };
      }

      try {
        if (exists) fs.unlinkSync(cachePath);
        liveIndex = null;
        indexState = "idle";
        startBackgroundIndex();
        return {
          content: [
            {
              type: "text",
              text: `Cache cleared${exists ? ` (deleted ${cachePath})` : " (no file existed)"}. Rebuilding index in the background — use vault_info to check progress.`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `clear_index failed: ${err instanceof Error ? err.message : String(err)}`,
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
      const ts = liveIndex.lastReHash ? new Date(liveIndex.lastReHash).toLocaleString() : "unknown";

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
