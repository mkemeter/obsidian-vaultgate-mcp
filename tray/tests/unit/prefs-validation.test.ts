/**
 * Unit tests for `tray/src/prefs-validation.ts` — the IPC-boundary validation
 * of Preferences config patches (M-2). The renderer duplicates lightweight
 * checks for instant feedback, but this module is the source of truth.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_FILE } from "../../src/context-file.js";
import { MAX_INJECT_INTERVAL, MIN_INJECT_INTERVAL } from "../../src/inject-interval.js";
import {
  MAX_TRAY_PORT,
  MIN_TRAY_PORT,
  validateConfigPatch,
} from "../../src/prefs-validation.js";

describe("validateConfigPatch", () => {
  it("passes an empty patch through untouched", () => {
    expect(validateConfigPatch({})).toEqual({});
  });

  describe("port", () => {
    it.each([MIN_TRAY_PORT, 3002, MAX_TRAY_PORT])("accepts valid port %i", (port) => {
      expect(validateConfigPatch({ port }).port).toBe(port);
    });

    it.each([MIN_TRAY_PORT - 1, MAX_TRAY_PORT + 1])("rejects out-of-range port %i", (port) => {
      expect(() => validateConfigPatch({ port })).toThrow(/Invalid port/);
    });

    it("rejects a non-integer port", () => {
      expect(() => validateConfigPatch({ port: 3002.5 })).toThrow(/Invalid port/);
    });

    it("rejects a string port (IPC payloads are untyped at runtime)", () => {
      expect(() => validateConfigPatch({ port: "3002" as unknown as number })).toThrow(
        /Invalid port/
      );
    });
  });

  describe("contextFileName", () => {
    it("accepts a bare .md name and trims it", () => {
      expect(validateConfigPatch({ contextFileName: "  MY.md  " }).contextFileName).toBe("MY.md");
    });

    it("normalizes an empty value to the default", () => {
      expect(validateConfigPatch({ contextFileName: "" }).contextFileName).toBe(
        DEFAULT_CONTEXT_FILE
      );
    });

    it.each(["folder/note.md", "folder\\note.md", "a..md", "notes.txt"])(
      "rejects invalid filename %j",
      (name) => {
        expect(() => validateConfigPatch({ contextFileName: name })).toThrow(
          /Invalid conventions filename/
        );
      }
    );
  });

  describe("injectIntervalSecs", () => {
    it.each([MIN_INJECT_INTERVAL, 30, MAX_INJECT_INTERVAL])("accepts valid interval %i", (v) => {
      expect(validateConfigPatch({ injectIntervalSecs: v }).injectIntervalSecs).toBe(v);
    });

    it.each([MIN_INJECT_INTERVAL - 1, 0, MAX_INJECT_INTERVAL + 1])(
      "rejects out-of-range interval %i",
      (v) => {
        expect(() => validateConfigPatch({ injectIntervalSecs: v })).toThrow(
          /Invalid injection interval/
        );
      }
    );

    it("rejects a non-integer interval", () => {
      expect(() => validateConfigPatch({ injectIntervalSecs: 2.5 })).toThrow(
        /Invalid injection interval/
      );
    });
  });

  describe("obsidianPath", () => {
    it("accepts a non-empty path", () => {
      expect(validateConfigPatch({ obsidianPath: "/opt/Obsidian/Obsidian.app" }).obsidianPath).toBe(
        "/opt/Obsidian/Obsidian.app"
      );
    });

    it("rejects an empty path", () => {
      expect(() => validateConfigPatch({ obsidianPath: "" })).toThrow(/non-empty/);
    });

    it("rejects a whitespace-only path", () => {
      expect(() => validateConfigPatch({ obsidianPath: "   " })).toThrow(/non-empty/);
    });
  });
});