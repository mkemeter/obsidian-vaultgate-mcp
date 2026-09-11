/**
 * Packaging regression — every bare module imported under src/ must be
 * declared in package.json (dependencies or optionalDependencies).
 *
 * Bug (phantom dependency): ~10 tool modules import `zod`, but `zod` was
 * never declared. The published package only got zod as a transitive
 * dependency of the MCP SDK, and would break the moment the SDK stopped
 * shipping it (or dedupe changed). Declared-in-package.json is the only
 * contract npm install honors for the published tarball.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
const PKG = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8")
) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Extract bare (package) import specifiers from one TypeScript source file. */
function bareSpecifiersFromFile(file: string): Set<string> {
  const src = fs.readFileSync(file, "utf-8");
  const out = new Set<string>();
  // Static: `import ... from "spec"`, `export ... from "spec"` (incl. multiline).
  for (const m of src.matchAll(/\bfrom\s*["']([^"'\n]+)["']/g)) {
    out.add(m[1] ?? "");
  }
  // Dynamic: `import("spec")`.
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) {
    out.add(m[1] ?? "");
  }
  const bare = new Set<string>();
  for (const spec of out) {
    if (!spec) continue;
    if (spec.startsWith(".") || spec.startsWith("/")) continue; // relative
    if (spec.startsWith("node:") || spec.startsWith("node/")) continue; // builtins
    bare.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"));
  }
  return bare;
}

function allBarePackages(): Set<string> {
  const all = new Set<string>();
  for (const file of listTsFiles(SRC_DIR)) {
    for (const spec of bareSpecifiersFromFile(file)) all.add(spec);
  }
  return all;
}

describe("packaging — declared dependencies", () => {
  // Sanity pin: the scanner must actually discover the codebase's real bare
  // imports — if this starts failing, the regex above has gone stale and the
  // regression test below is meaningless.
  it("scanner sanity: discovers known declared bare imports under src/", () => {
    const found = allBarePackages();
    expect(found.has("@modelcontextprotocol/sdk")).toBe(true);
    expect(found.has("@xenova/transformers")).toBe(true);
  });

  // regression (red until fixed): `zod` is imported throughout src/tools/* but
  // is declared nowhere in package.json — a phantom dependency.
  it("every bare import under src/ is declared in package.json", () => {
    const declared = new Set([
      ...Object.keys(PKG.dependencies ?? {}),
      ...Object.keys(PKG.optionalDependencies ?? {}),
    ]);
    const missing = [...allBarePackages()].filter((p) => !declared.has(p)).sort();
    expect(
      missing,
      `undeclared bare imports in src/ (declare them in dependencies/optionalDependencies): ${missing.join(", ")}`
    ).toEqual([]);
  });
});
