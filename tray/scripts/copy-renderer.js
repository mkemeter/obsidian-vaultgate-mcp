#!/usr/bin/env node
/**
 * Copies `renderer/` into `dist/renderer/` so the packaged app can load
 * `prefs.html` and the compiled preload bundle from a stable location.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = path.join(root, "renderer");
const dst = path.join(root, "dist", "renderer");

function copyRecursive(srcPath, dstPath) {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    fs.mkdirSync(dstPath, { recursive: true });
    for (const entry of fs.readdirSync(srcPath)) {
      copyRecursive(path.join(srcPath, entry), path.join(dstPath, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
  }
}

if (!fs.existsSync(src)) {
  console.error(`[copy-renderer] source not found: ${src}`);
  process.exit(1);
}

copyRecursive(src, dst);
console.log(`[copy-renderer] copied ${src} → ${dst}`);
