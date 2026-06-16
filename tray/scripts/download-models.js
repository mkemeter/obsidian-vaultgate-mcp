#!/usr/bin/env node
/**
 * Pre-downloads the embedding model into `tray/assets/models/` at build time
 * so the packaged app ships with the model and works offline on first run.
 *
 * The download uses `env.cacheDir` so the resulting directory layout is the
 * exact HuggingFace snapshot format that `@xenova/transformers` expects at
 * runtime — `models--Xenova--bge-small-en-v1.5/snapshots/<hash>/...`.
 *
 * Idempotent: skipped automatically if the model is already present in the
 * target cache (CI also caches `tray/assets/models/`).
 */

const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const transformers = await import("@xenova/transformers");
  const { env, pipeline } = transformers;

  const cacheDir = path.resolve(__dirname, "..", "assets", "models");
  fs.mkdirSync(cacheDir, { recursive: true });
  env.cacheDir = cacheDir;
  env.allowRemoteModels = true;

  const MODEL_ID = "Xenova/bge-small-en-v1.5";
  const expectedDir = path.join(cacheDir, "models--Xenova--bge-small-en-v1.5");
  if (fs.existsSync(expectedDir)) {
    console.log(`[download-models] cache hit — ${expectedDir}`);
    return;
  }

  console.log(`[download-models] downloading ${MODEL_ID} → ${cacheDir}`);
  await pipeline("feature-extraction", MODEL_ID);
  console.log("[download-models] done");
})().catch((err) => {
  console.error("[download-models] failed:", err);
  process.exit(1);
});
