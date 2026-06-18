#!/usr/bin/env node
/**
 * Generates all VaultGate icon PNGs from SVG sources.
 *
 * Menu-bar template icons (monochrome keyhole):
 *   tray/assets/icon@2x.png  44×44  RGBA, black shape on transparent bg
 *   tray/assets/icon.png     22×22  RGBA, downscaled from @2x
 *
 * App bundle icon (full-color crystal, for DMG/app icon):
 *   tray/build/icon.png      1024×1024  RGBA
 *
 * Run once after editing the SVG sources:
 *   node tray/scripts/generate-icons.js  (from repo root)
 *   node scripts/generate-icons.js       (from tray/)
 *
 * NOT part of the automated build pipeline — generated PNGs are committed.
 * Requires: sharp (tray devDependency ^0.35.1)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// sharp is a sub-dependency of @xenova/transformers; the tray's own node_modules/sharp
// contains only type stubs. Resolve via the package name (Node will find it automatically).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// sharp rasterises SVGs at their declared pixel dimensions, then resizes the raster.
// To avoid a tiny 64px gem in a 1024px white canvas we rewrite width/height to the
// target size before passing the buffer — librsvg then renders at full resolution.
function svgAt(buf, w, h) {
  return Buffer.from(
    buf
      .toString("utf8")
      .replace(/width="\d+"/, `width="${w}"`)
      .replace(/height="\d+"/, `height="${h}"`),
  );
}

const keyholesvg = readFileSync(join(__dirname, "keyhole-template.svg"));
const appIconSvg = readFileSync(join(root, "assets", "icon.svg"));

// Menu-bar template icons: monochrome keyhole, black on transparent background.
// macOS template image rendering uses the alpha channel as an opacity mask and
// discards RGB — the shape must be opaque black on a transparent background.
await sharp(svgAt(keyholesvg, 44, 44)).png().toFile(join(root, "assets", "icon@2x.png"));
console.log("✓ assets/icon@2x.png (44×44 monochrome keyhole)");

await sharp(svgAt(keyholesvg, 22, 22)).png().toFile(join(root, "assets", "icon.png"));
console.log("✓ assets/icon.png (22×22 monochrome keyhole)");

// App bundle icon: full-color crystal gem for DMG/macOS app icon.
await sharp(svgAt(appIconSvg, 1024, 1024)).png().toFile(join(root, "build", "icon.png"));
console.log("✓ build/icon.png (1024×1024 full-color gem)");

console.log("\n[generate-icons] Done. Commit the updated PNG files.");
