/**
 * Invariant: VaultGate must never access the vault filesystem directly.
 *
 * All vault I/O goes through runObsidian() (the CLI). Direct node:fs imports in
 * any tool module would break this guarantee — vault paths are opaque strings
 * that only make sense to the Obsidian CLI, not to Node.js.
 *
 * Legitimate node:fs users (explicitly excluded from this guard):
 *   - health.ts      — checks CLI binary existence on the local system
 *   - server.ts      — reads bundled icon files and package.json
 *   - tools/semantic.ts — reads/writes a local index cache (not vault content)
 *
 * Everything else in server/src/ and server/src/tools/ must remain fs-free.
 *
 * This test reads TypeScript source files on disk (the *code*, not vault
 * content) and asserts no `node:fs` import. It runs in CI as part of
 * `npm test` so any accidental re-introduction is caught immediately.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const SERVER_SRC = path.join(__dirname, "..", "..", "src");

// All tool files except semantic.ts (which legitimately manages a local cache).
const ALLOWED_FS_IN_TOOLS = new Set(["semantic.ts"]);

const GUARDED_FILES = [
  // scope.ts was rewritten to use CLI exclusively — must never re-add fs.
  path.join(SERVER_SRC, "scope.ts"),
  // All tool files are vault-facing; none should ever import node:fs.
  ...fs
    .readdirSync(path.join(SERVER_SRC, "tools"))
    .filter((f) => f.endsWith(".ts") && !ALLOWED_FS_IN_TOOLS.has(f))
    .map((f) => path.join(SERVER_SRC, "tools", f)),
];

describe("CLI-only invariant: no direct vault filesystem access", () => {
  it.each(GUARDED_FILES.map((f) => [path.relative(SERVER_SRC, f), f]))(
    "%s must not import node:fs",
    (_rel, filePath) => {
      const source = fs.readFileSync(filePath, "utf-8");
      expect(source).not.toMatch(/from\s+["']node:fs["']/);
    }
  );
});
