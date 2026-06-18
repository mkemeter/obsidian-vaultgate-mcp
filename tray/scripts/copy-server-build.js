#!/usr/bin/env node
/**
 * Copies the compiled server build/ output into dist/server/build/ and
 * the server's node_modules into dist/server/node_modules/.
 *
 * We ship the unbundled build rather than an esbuild bundle because the
 * server's dependency stack (zod, @xenova/transformers, onnxruntime-node)
 * has CJS/ESM interop characteristics that esbuild's bundler mishandles.
 */

const fs = require("node:fs");
const path = require("node:path");
const { copyRecursive } = require("./lib/copy.js");

const root = path.resolve(__dirname, "..");
const serverRoot = path.join(root, "..", "server");

const copies = [
  { src: path.join(serverRoot, "build"), dst: path.join(root, "dist", "server", "build") },
  { src: path.join(serverRoot, "package.json"), dst: path.join(root, "dist", "server", "package.json") },
];

for (const { src, dst } of copies) {
  if (!fs.existsSync(src)) {
    console.error(`[copy-server-build] source not found: ${src}`);
    process.exit(1);
  }
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  copyRecursive(src, dst);
  console.log(`[copy-server-build] ${path.relative(root, src)} → ${path.relative(root, dst)}`);
}
