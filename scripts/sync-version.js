#!/usr/bin/env node
/**
 * Syncs the canonical version from the root VERSION file into
 * server/package.json and tray/package.json.
 *
 * Run from the repo root after editing VERSION:
 *   node scripts/sync-version.js
 *
 * Also called automatically by CI before every build step.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = readFileSync(join(root, "VERSION"), "utf8").trim();

for (const dir of ["server", "tray"]) {
  const pkgPath = join(root, dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.version === version) {
    console.log(`  ${dir}/package.json already at ${version}`);
    continue;
  }
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${dir}/package.json → ${version}`);
}
