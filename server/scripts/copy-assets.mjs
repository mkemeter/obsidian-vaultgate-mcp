#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(serverDir, "src");
const build = join(serverDir, "build");
const repoRoot = dirname(serverDir);

mkdirSync(build, { recursive: true });
copyFileSync(join(src, "icon.svg"), join(build, "icon.svg"));
copyFileSync(join(src, "favicon.ico"), join(build, "favicon.ico"));
copyFileSync(join(repoRoot, "README.md"), join(serverDir, "README.md"));
