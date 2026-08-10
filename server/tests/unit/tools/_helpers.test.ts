import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1", excludePaths: [] },
}));

const { config: mockConfig } = await import("../../../src/config.js");
const { dryRunSchema, isExcluded, filterExcluded } = await import("../../../src/tools/_helpers.js");

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
});

describe("isExcluded", () => {
  it("returns false when excludePaths is empty", () => {
    (mockConfig as any).excludePaths = [];
    expect(isExcluded("Private/note.md")).toBe(false);
  });

  it("excludes exact prefix match", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(isExcluded("Private")).toBe(true);
  });

  it("excludes path under prefix", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(isExcluded("Private/note.md")).toBe(true);
  });

  it("does not exclude path that only shares a substring", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(isExcluded("PrivateNotes/note.md")).toBe(false);
  });

  it("handles prefix with trailing slash", () => {
    (mockConfig as any).excludePaths = ["Private/"];
    expect(isExcluded("Private/note.md")).toBe(true);
  });

  it("normalises backslashes", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(isExcluded("Private\\note.md")).toBe(true);
  });
});

describe("filterExcluded", () => {
  it("passes through output when excludePaths is empty", () => {
    (mockConfig as any).excludePaths = [];
    expect(filterExcluded("a.md\nb.md")).toBe("a.md\nb.md");
  });

  it("removes excluded lines", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(filterExcluded("Public/a.md\nPrivate/secret.md\nPublic/b.md")).toBe("Public/a.md\nPublic/b.md");
  });

  it("keeps blank lines", () => {
    (mockConfig as any).excludePaths = ["Private"];
    expect(filterExcluded("Public/a.md\n\nPrivate/x.md")).toBe("Public/a.md\n");
  });
});
