#!/usr/bin/env node
/**
 * Syncs the canonical version from the root VERSION file into
 * server/package.json, tray/package.json, and the MCP registry
 * manifest server.json.
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

// MCP registry manifest — top-level version and the npm package version
// must both track the canonical VERSION.
const manifestPath = join(root, "server.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pkgVersion = manifest.packages?.[0]?.version;
if (manifest.version === version && pkgVersion === version) {
  console.log(`  server.json already at ${version}`);
} else {
  manifest.version = version;
  if (manifest.packages?.[0]) {
    manifest.packages[0].version = version;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  server.json → ${version}`);
}
