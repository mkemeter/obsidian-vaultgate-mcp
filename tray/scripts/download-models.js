#!/usr/bin/env node
/**
 * Pre-downloads the embedding model into `tray/assets/models/` at build time
 * so the packaged app ships with the model and works offline on first run.
 *
 * The download uses `env.cacheDir`; the installed @xenova/transformers (>= 2.17)
 * stores the model in the flat layout `<cacheDir>/<model_id>/` (verified
 * against the installed hub.js: `fsCacheKey = pathJoin(model_id, file)`). The
 * pre-2.17 HuggingFace snapshot layout (`models--Xenova--all-MiniLM-L6-v2/
 * snapshots/<hash>/`) is no longer produced, so the idempotency check below
 * looks for the ONNX weights file directly.
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

  const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
  // This model ships the quantized ONNX weights; `model.onnx` (unquantized) is
  // accepted too so a future transformers.js default flip doesn't re-download
  // on every build.
  const onnxDir = path.join(cacheDir, MODEL_ID, "onnx");
  const isPresent = ["model_quantized.onnx", "model.onnx"].some((f) =>
    fs.existsSync(path.join(onnxDir, f))
  );
  if (isPresent) {
    console.log(`[download-models] cache hit — ${onnxDir}`);
    return;
  }

  console.log(`[download-models] downloading ${MODEL_ID} → ${cacheDir}`);
  await pipeline("feature-extraction", MODEL_ID);
  console.log("[download-models] done");
})().catch((err) => {
  console.error("[download-models] failed:", err);
  process.exit(1);
});
