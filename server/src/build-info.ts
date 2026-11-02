/**
 * Build-time metadata injected by scripts/copy-assets.mjs after tsc runs.
 * The values here are development defaults; the real values are written into
 * build/build-info.js by the build script and never tracked by git.
 */
export const BUILD_INFO: { version: string; built: string; commit: string } = {
  version: "dev",
  built: "dev",
  commit: "dev",
};
