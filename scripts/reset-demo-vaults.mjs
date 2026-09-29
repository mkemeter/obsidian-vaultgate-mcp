#!/usr/bin/env node
/**
 * Resets every local demo vault under assets/ to the latest state on origin/main.
 *
 * For each directory matching assets/demo-vault* it:
 *   1. fetches origin/main,
 *   2. restores tracked notes to the origin/main version (git restore),
 *   3. deletes stray untracked notes (git clean -fd) while preserving the
 *      gitignored .obsidian/ workspace state (no -x).
 *
 * Run from the repo root:
 *   node scripts/reset-demo-vaults.mjs
 *
 * Only the discovered assets/demo-vault* directories are touched — never a
 * repo-wide clean. JWD-side reset (deleting the Space, clearing conversation
 * history) is manual and NOT handled here.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Run a git command from the repo root and return trimmed stdout. */
function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// --- Discover demo vaults ---

let vaults;
try {
  vaults = readdirSync(join(root, "assets"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("demo-vault"))
    .map((e) => `assets/${e.name}`)
    .sort();
} catch {
  vaults = [];
}

if (vaults.length === 0) {
  console.log("  no demo vaults found under assets/ — nothing to reset");
  process.exit(0);
}

console.log(`  found ${vaults.length} demo vault(s): ${vaults.join(", ")}`);

// --- Fetch origin/main (source of truth) ---

try {
  git(["fetch", "origin", "main"]);
  console.log("  fetched origin/main");
} catch (err) {
  console.error(`  error: git fetch origin main failed — ${err.message}`);
  process.exit(1);
}

// --- Restore + clean each vault, scoped strictly to its path ---

for (const vault of vaults) {
  try {
    git(["restore", "--source=origin/main", "--staged", "--worktree", "--", vault]);
    console.log(`  ${vault} → restored to origin/main`);
  } catch (err) {
    console.error(`  error: git restore failed for ${vault} — ${err.message}`);
    process.exit(1);
  }

  let removed;
  try {
    // -fd removes untracked files/dirs; NO -x, so gitignored .obsidian/ survives.
    removed = git(["clean", "-fd", "--", vault]);
  } catch (err) {
    console.error(`  error: git clean failed for ${vault} — ${err.message}`);
    process.exit(1);
  }
  if (removed) {
    for (const line of removed.split("\n")) {
      console.log(`  ${vault} → ${line}`);
    }
  } else {
    console.log(`  ${vault} → no stray files`);
  }
}

// --- Summary ---

const dirty = git(["status", "--short", "--", ...vaults]);
if (dirty) {
  console.error("  warning: vault paths still show changes after reset:");
  console.error(dirty);
  process.exit(1);
}
console.log("  done — all demo vaults match origin/main");
