#!/usr/bin/env node
/** Shared recursive file-copy utility used by build scripts. */

const fs = require("node:fs");
const path = require("node:path");

/**
 * Recursively copies src to dst, creating intermediate directories as needed.
 * @param {string} src  Absolute source path (file or directory).
 * @param {string} dst  Absolute destination path.
 */
function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

module.exports = { copyRecursive };
