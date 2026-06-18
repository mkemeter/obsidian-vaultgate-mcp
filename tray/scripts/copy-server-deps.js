#!/usr/bin/env node
/**
 * Copies exactly the production runtime dependencies of the server into
 * dist/server/node_modules/ by asking npm for the full transitive closure.
 *
 * This avoids shipping devDependencies (typescript, @biomejs, vitest, etc.)
 * while ensuring every required package is present.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { copyRecursive } = require("./lib/copy.js");

const root = path.resolve(__dirname, "..");
const serverRoot = path.join(root, "..", "server");
const srcBase = path.join(serverRoot, "node_modules");
const dstBase = path.join(root, "dist", "server", "node_modules");

// Ask npm for the full production dep tree (all transitive deps, no devDeps).
let prodPkgs;
try {
  const out = execSync("npm ls --prod --parseable --all 2>/dev/null", {
    cwd: serverRoot,
    encoding: "utf8",
  });
  // Each line is an absolute path ending at the package root.
  // Strip the serverRoot/node_modules/ prefix to get the package name (handles scoped).
  const prefix = srcBase + path.sep;
  prodPkgs = [
    ...new Set(
      out
        .split("\n")
        .filter((l) => l.startsWith(prefix))
        .map((l) => l.slice(prefix.length).split(path.sep)[0])
        // Re-include scoped packages (e.g. @scope/pkg)
        .map((_, i, arr) => {
          const line = out.split("\n").filter((l) => l.startsWith(prefix))[i];
          const rel = line.slice(prefix.length);
          const parts = rel.split(path.sep);
          return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
        })
    ),
  ];
} catch (e) {
  console.error("[copy-server-deps] npm ls failed:", e.message);
  process.exit(1);
}

if (fs.existsSync(dstBase)) fs.rmSync(dstBase, { recursive: true, force: true });
fs.mkdirSync(dstBase, { recursive: true });

let copied = 0;
for (const pkg of prodPkgs) {
  const src = path.join(srcBase, pkg);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(dstBase, pkg);
  copyRecursive(src, dst);
  copied++;
}
console.log(`[copy-server-deps] copied ${copied} production packages → dist/server/node_modules/`);
