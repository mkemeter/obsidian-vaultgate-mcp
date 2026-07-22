/**
 * Unit tests for `tray/src/context-file.ts`.
 *
 * Pure validation helpers — no Electron, no filesystem. These carry the tray's
 * conventions-filename validation coverage (the renderer and Electron-wrapper
 * files are excluded from coverage).
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_FILE,
  isValidContextFileName,
  normalizeContextFileName,
} from "../../src/context-file.js";

describe("isValidContextFileName", () => {
  it("treats empty / whitespace / undefined as valid (default applies downstream)", () => {
    expect(isValidContextFileName(undefined)).toBe(true);
    expect(isValidContextFileName("")).toBe(true);
    expect(isValidContextFileName("   ")).toBe(true);
  });

  it("accepts a bare .md filename, case-insensitive extension", () => {
    expect(isValidContextFileName("CLAUDE.md")).toBe(true);
    expect(isValidContextFileName("VAULTGATE.md")).toBe(true);
    expect(isValidContextFileName("Notes.MD")).toBe(true);
  });

  it("rejects forward-slash path separators", () => {
    expect(isValidContextFileName("sub/CLAUDE.md")).toBe(false);
  });

  it("rejects backslash path separators", () => {
    expect(isValidContextFileName("sub\\CLAUDE.md")).toBe(false);
  });

  it("rejects parent-directory segments", () => {
    expect(isValidContextFileName("../CLAUDE.md")).toBe(false);
  });

  it("rejects filenames that do not end in .md", () => {
    expect(isValidContextFileName("notes.txt")).toBe(false);
    expect(isValidContextFileName("CLAUDE")).toBe(false);
  });
});

describe("normalizeContextFileName", () => {
  it("returns the default for empty / whitespace / undefined", () => {
    expect(normalizeContextFileName(undefined)).toBe(DEFAULT_CONTEXT_FILE);
    expect(normalizeContextFileName("")).toBe(DEFAULT_CONTEXT_FILE);
    expect(normalizeContextFileName("   ")).toBe(DEFAULT_CONTEXT_FILE);
  });

  it("trims and returns a provided filename", () => {
    expect(normalizeContextFileName("  CLAUDE.md  ")).toBe("CLAUDE.md");
  });

  it("exposes VAULTGATE.md as the default", () => {
    expect(DEFAULT_CONTEXT_FILE).toBe("VAULTGATE.md");
  });
});
