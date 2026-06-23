#!/usr/bin/env node
/**
 * Generates the DMG installer background image.
 *
 * Output:
 *   tray/build/dmg-background.png  660×450  RGBA
 *
 * The background is shown in the DMG window when users open the downloaded disk image.
 * It instructs users to drag VaultGate to Applications and warns about the Gatekeeper
 * "damaged app" error that affects unsigned apps on macOS 15+.
 *
 * Run once when the design changes:
 *   node tray/scripts/make-dmg-background.js  (from repo root)
 *   node scripts/make-dmg-background.js       (from tray/)
 *
 * NOT part of the automated build pipeline — the generated PNG is committed.
 * Requires: sharp (tray devDependency ^0.35.1)
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// DMG window dimensions (must match electron-builder.yml dmg.window)
const W = 660;
const H = 450;

// Icon center positions (must match electron-builder.yml dmg.contents)
const APP_X = 180;
const APP_Y = 145;
const APP_LINK_X = 480;
const INSTALL_X = 330;

// Warning box geometry
const BOX_Y = 262;
const BOX_H = 90;

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdfcff"/>
      <stop offset="100%" stop-color="#f0ecff"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Top accent bar -->
  <rect width="${W}" height="3" fill="#7c3aed"/>

  <!-- Drag arrow: from right edge of app icon zone to left edge of Applications zone -->
  <rect x="246" y="${APP_Y - 3}" width="162" height="6" rx="3" fill="#c4b5fd"/>
  <polygon points="408,${APP_Y - 11} 426,${APP_Y} 408,${APP_Y + 11}" fill="#c4b5fd"/>

  <!-- Icon labels -->
  <text x="${APP_X}" y="${APP_Y + 100}"
    text-anchor="middle"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="13" fill="#6b7280">VaultGate</text>
  <text x="${APP_LINK_X}" y="${APP_Y + 100}"
    text-anchor="middle"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="13" fill="#6b7280">Applications</text>

  <!-- Divider -->
  <line x1="20" y1="${BOX_Y - 10}" x2="${W - 20}" y2="${BOX_Y - 10}"
    stroke="#e5e0f8" stroke-width="1"/>

  <!-- Warning box -->
  <rect x="16" y="${BOX_Y}" width="${W - 32}" height="${BOX_H}" rx="8"
    fill="#fffbeb" stroke="#fcd34d" stroke-width="1.5"/>

  <!-- Warning icon circle -->
  <circle cx="38" cy="${BOX_Y + 22}" r="11" fill="#d97706"/>
  <text x="38" y="${BOX_Y + 27}"
    text-anchor="middle"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="14" font-weight="bold" fill="white">!</text>

  <!-- Warning heading -->
  <text x="58" y="${BOX_Y + 27}"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="13" font-weight="bold" fill="#92400e">macOS may block VaultGate on first launch</text>

  <!-- Warning body -->
  <text x="28" y="${BOX_Y + 50}"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="12" fill="#78350f">Open INSTALL.txt (icon below) for the fix, or run this command in Terminal:</text>

  <!-- xattr command box -->
  <rect x="28" y="${BOX_Y + 58}" width="${W - 56}" height="24" rx="4"
    fill="#ede9fe" stroke="#c4b5fd" stroke-width="1"/>
  <text x="38" y="${BOX_Y + 74}"
    font-family="Courier New,Courier,monospace"
    font-size="11.5" fill="#5b21b6">xattr -r -d com.apple.quarantine /Applications/VaultGate.app</text>

  <!-- Arrow pointing down to INSTALL.txt icon -->
  <text x="${INSTALL_X}" y="${BOX_Y + BOX_H + 26}"
    text-anchor="middle"
    font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
    font-size="11" fill="#7c3aed">&#x25BC;&#x2002;INSTALL.txt</text>
</svg>
`.trim();

await sharp(Buffer.from(svg)).png().toFile(join(root, "build", "dmg-background.png"));
console.log(`✓ build/dmg-background.png (${W}×${H} DMG background)`);
console.log("\n[make-dmg-background] Done. Commit the updated PNG.");
