import { describe, it, expect, afterEach } from "vitest";
import {
  buildFileArgs,
  contentSizeGuard,
  DARWIN_CONTENT_LIMIT,
  dryRunSchema,
  dryRunPreview,
  errorMessage,
  optionalBoolSchema,
  requiredBoolSchema,
  WIN32_CONTENT_LIMIT,
} from "../../../src/tools/_helpers.js";
import { config } from "../../../src/config.js";

// dryRunSchema must coerce string values from clients that serialise
// booleans as strings, so that dryRun="false" actually executes.

describe("dryRunSchema", () => {
  it("accepts boolean true → true", () => {
    expect(dryRunSchema.parse(true)).toBe(true);
  });

  it("accepts boolean false → false", () => {
    expect(dryRunSchema.parse(false)).toBe(false);
  });

  it("coerces string 'false' → false", () => {
    expect(dryRunSchema.parse("false")).toBe(false);
  });

  it("coerces string '0' → false", () => {
    expect(dryRunSchema.parse("0")).toBe(false);
  });

  it("coerces string 'no' → false", () => {
    expect(dryRunSchema.parse("no")).toBe(false);
  });

  it("coerces string 'true' → true", () => {
    expect(dryRunSchema.parse("true")).toBe(true);
  });

  it("defaults to true when undefined", () => {
    expect(dryRunSchema.parse(undefined)).toBe(true);
  });

  it("description mentions the default and preview behavior", () => {
    // Pin the StringLiteral on line 27 of _helpers.ts to kill the mutant that
    // removes "When true (default), returns a preview without executing."
    expect(dryRunSchema.description).toContain("When true (default), returns a preview without executing");
  });
});

describe("dryRunPreview", () => {
  const originalVault = config.vault;
  afterEach(() => {
    config.vault = originalVault;
  });

  it("omits the vault prefix when no vault is configured", () => {
    config.vault = undefined;
    const preview = dryRunPreview(["create", "name=X"]);
    expect(preview).toContain("[DRY RUN]");
    expect(preview).toContain("obsidian create name=X");
    expect(preview).not.toContain("vault=");
  });

  it("includes the vault prefix when a vault is configured", () => {
    config.vault = "MyVault";
    const preview = dryRunPreview(["create", "name=X"]);
    expect(preview).toContain("obsidian vault=MyVault create name=X");
  });
});

describe("errorMessage", () => {
  it("returns .message when given an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("converts non-Error values to string", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage({ msg: "obj" })).toBe("[object Object]");
  });
});

describe("optionalBoolSchema", () => {
  it("resolves to undefined when input is undefined", () => {
    expect(optionalBoolSchema.parse(undefined)).toBeUndefined();
  });

  it("resolves to false for boolean false", () => {
    expect(optionalBoolSchema.parse(false)).toBe(false);
  });

  it("resolves to false for string 'false'", () => {
    expect(optionalBoolSchema.parse("false")).toBe(false);
  });

  it("resolves to false for string '0'", () => {
    expect(optionalBoolSchema.parse("0")).toBe(false);
  });

  it("resolves to false for string 'no'", () => {
    expect(optionalBoolSchema.parse("no")).toBe(false);
  });

  it("resolves to true for boolean true", () => {
    expect(optionalBoolSchema.parse(true)).toBe(true);
  });
});

describe("requiredBoolSchema", () => {
  it("resolves to false for boolean false", () => {
    expect(requiredBoolSchema.parse(false)).toBe(false);
  });

  it("resolves to false for string 'false'", () => {
    expect(requiredBoolSchema.parse("false")).toBe(false);
  });

  it("resolves to false for string '0'", () => {
    expect(requiredBoolSchema.parse("0")).toBe(false);
  });

  it("resolves to false for string 'no'", () => {
    expect(requiredBoolSchema.parse("no")).toBe(false);
  });

  it("resolves to true for boolean true", () => {
    expect(requiredBoolSchema.parse(true)).toBe(true);
  });
});

describe("buildFileArgs", () => {
  it("returns path= arg when path is provided", () => {
    expect(buildFileArgs(undefined, "Projects/Note.md")).toEqual(["path=Projects/Note.md"]);
  });

  it("returns file= arg when only file is provided", () => {
    expect(buildFileArgs("My Note", undefined)).toEqual(["file=My Note"]);
  });

  it("path takes precedence over file when both are provided", () => {
    expect(buildFileArgs("My Note", "Projects/Note.md")).toEqual(["path=Projects/Note.md"]);
  });

  it("returns empty array when neither is provided", () => {
    expect(buildFileArgs(undefined, undefined)).toEqual([]);
  });

  it("returns empty array when path is whitespace-only (trim kills the arg)", () => {
    // regression: path?.trim() check (line 96) was mutated to path? — without
    // trim(), "  " would be truthy and incorrectly produce ["path=  "]
    expect(buildFileArgs(undefined, "  ")).toEqual([]);
  });

  it("returns empty array when file is whitespace-only (trim kills the arg)", () => {
    // regression: file?.trim() check (line 97) same pattern
    expect(buildFileArgs("  ", undefined)).toEqual([]);
  });
});

describe("contentSizeGuard", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(process, "platform", originalDescriptor);
  });

  function setPlatform(p: string) {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  // ── Windows boundary ────────────────────────────────────────────────────────

  it("returns null on Windows when content is exactly at the WIN32 limit", () => {
    setPlatform("win32");
    expect(contentSizeGuard("x".repeat(WIN32_CONTENT_LIMIT), "s")).toBeNull();
  });

  it("returns error on Windows when content is one byte over the WIN32 limit", () => {
    setPlatform("win32");
    const result = contentSizeGuard("x".repeat(WIN32_CONTENT_LIMIT + 1), "use split strategy");
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("Content too large");
    expect(result?.content[0].text).toContain("use split strategy");
  });

  // ── macOS boundary ──────────────────────────────────────────────────────────

  it("returns null on macOS when content is exactly at the DARWIN limit", () => {
    setPlatform("darwin");
    expect(contentSizeGuard("x".repeat(DARWIN_CONTENT_LIMIT), "s")).toBeNull();
  });

  it("returns error on macOS when content is one byte over the DARWIN limit", () => {
    setPlatform("darwin");
    const result = contentSizeGuard("x".repeat(DARWIN_CONTENT_LIMIT + 1), "use split strategy");
    expect(result).not.toBeNull();
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("Content too large");
    expect(result?.content[0].text).toContain("use split strategy");
  });

  // ── Linux / other platforms ─────────────────────────────────────────────────

  it("returns null on Linux regardless of content size", () => {
    setPlatform("linux");
    expect(contentSizeGuard("x".repeat(DARWIN_CONTENT_LIMIT + 1), "s")).toBeNull();
  });

  it("returns null on Linux even for very large content (64 KB+)", () => {
    setPlatform("linux");
    expect(contentSizeGuard("x".repeat(64 * 1024 + 1), "s")).toBeNull();
  });

  // ── Cross-platform specificity ──────────────────────────────────────────────

  it("blocks on Windows for content between WIN32 and DARWIN limits, passes on macOS", () => {
    const content = "x".repeat(WIN32_CONTENT_LIMIT + 1); // over Windows limit, under macOS limit
    setPlatform("win32");
    expect(contentSizeGuard(content, "s")?.isError).toBe(true);
    setPlatform("darwin");
    expect(contentSizeGuard(content, "s")).toBeNull();
  });

  // ── Error message content ───────────────────────────────────────────────────

  it("error message includes platform name 'Windows' on win32", () => {
    setPlatform("win32");
    const result = contentSizeGuard("x".repeat(WIN32_CONTENT_LIMIT + 1), "s");
    expect(result?.content[0].text).toContain("Windows");
  });

  it("error message includes platform name 'macOS' on darwin", () => {
    setPlatform("darwin");
    const result = contentSizeGuard("x".repeat(DARWIN_CONTENT_LIMIT + 1), "s");
    expect(result?.content[0].text).toContain("macOS");
  });

  it("includes size in KB and WIN32 limit in the error message on Windows", () => {
    setPlatform("win32");
    const content = "x".repeat(20 * 1024); // 20 KB
    const result = contentSizeGuard(content, "strategy");
    expect(result?.content[0].text).toContain("20.0 KB");
    expect(result?.content[0].text).toContain(`${WIN32_CONTENT_LIMIT / 1024} KB`);
  });

  it("includes size in KB and DARWIN limit in the error message on macOS", () => {
    setPlatform("darwin");
    const content = "x".repeat(20 * 1024); // 20 KB
    const result = contentSizeGuard(content, "strategy");
    expect(result?.content[0].text).toContain("20.0 KB");
    expect(result?.content[0].text).toContain(`${DARWIN_CONTENT_LIMIT / 1024} KB`);
  });
});
