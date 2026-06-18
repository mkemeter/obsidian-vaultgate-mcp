#!/usr/bin/env node
/**
 * Copies `renderer/` into `dist/renderer/` so the packaged app can load
 * `prefs.html` and the compiled preload bundle from a stable location.
 */

const fs = require("node:fs");
const path = require("node:path");
const { copyRecursive } = require("./lib/copy.js");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "renderer");
const dst = path.join(root, "dist", "renderer");

if (!fs.existsSync(src)) {
  console.error(`[copy-renderer] source not found: ${src}`);
  process.exit(1);
}

copyRecursive(src, dst);
console.log(`[copy-renderer] copied ${src} → ${dst}`);
