/**
 * Global vitest setup — runs once per worker before any test module is imported.
 *
 * Redirects the embeddings index cache away from the real user cache
 * (`~/.cache/obsidian-vaultgate-mcp`) so the test suite never writes there.
 * `resolveIndexCacheDir()` in src/tools/semantic.ts reads this env var at call
 * time, so setting it here covers every test — including the ~50 that go through
 * the `freshModule` helper and the integration tests that trigger a background
 * index build.
 *
 * Each worker gets its own subdirectory. vitest's default forks pool runs test
 * files in parallel workers; without per-worker isolation, two workers writing
 * the fixed-name `embeddings-default.json` (the unit vault-switch tests and the
 * integration tests, whose vault defaults to "default") would race — one's
 * saveIndex tearing the other's loadIndex into a JSON.parse failure.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

if (!process.env.VAULTGATE_INDEX_CACHE_DIR) {
  // Unique per worker; pid is a robust fallback. A greppable path (not mkdtemp)
  // keeps the dir predictable when debugging a failing run.
  const workerId =
    process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);
  const dir = path.join(os.tmpdir(), "vaultgate-test-index", workerId);
  fs.rmSync(dir, { recursive: true, force: true }); // clear leftovers from a prior run
  fs.mkdirSync(dir, { recursive: true });
  process.env.VAULTGATE_INDEX_CACHE_DIR = dir;
}
