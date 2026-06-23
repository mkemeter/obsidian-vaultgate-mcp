#!/usr/bin/env node
/**
 * Creates the VaultGate DMG using create-dmg (HFS+ backed).
 *
 * electron-builder's built-in DMG creation uses APFS on Apple Silicon, which
 * silently breaks background image support. create-dmg uses HFS+ and correctly
 * applies the background image and Finder window customisation via AppleScript.
 *
 * Prerequisites:
 *   - electron-builder --mac --dir must have run first (produces dist/mac-arm64/)
 *   - create-dmg must be on PATH: brew install create-dmg
 *
 * Run:
 *   node tray/scripts/package-dmg.js   (from repo root)
 *   node scripts/package-dmg.js        (from tray/)
 *
 * Output: tray/dist/VaultGate-<version>-mac-arm64.dmg
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const { version } = pkg;
const outFile = join(root, "dist", `VaultGate-${version}-mac-arm64.dmg`);

console.log(`[package-dmg] Building VaultGate-${version}-mac-arm64.dmg …`);

execFileSync(
  "create-dmg",
  [
    "--volname", "VaultGate",
    "--background", join(root, "build", "dmg-background.png"),
    "--window-pos", "200", "120",
    "--window-size", "660", "450",
    "--icon-size", "80",
    "--icon", "VaultGate.app", "180", "145",
    "--hide-extension", "VaultGate.app",
    "--app-drop-link", "480", "145",
    "--add-file", "INSTALL.txt", join(root, "build", "INSTALL.txt"), "330", "395",
    "--no-internet-enable",
    "--filesystem", "HFS+",
    outFile,
    join(root, "dist", "mac-arm64"),
  ],
  { stdio: "inherit" },
);

console.log(`\n[package-dmg] ✓ ${outFile}`);
