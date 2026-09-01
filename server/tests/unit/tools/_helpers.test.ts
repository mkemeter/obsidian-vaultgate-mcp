import { describe, it, expect, afterEach } from "vitest";
import {
  buildFileArgs,
  dryRunSchema,
  dryRunPreview,
  errorMessage,
  optionalBoolSchema,
  requiredBoolSchema,
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
