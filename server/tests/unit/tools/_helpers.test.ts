import { describe, it, expect, afterEach } from "vitest";
import { dryRunSchema, dryRunPreview } from "../../../src/tools/_helpers.js";
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
});

describe("dryRunPreview", () => {
  // config.vault is a mutable module singleton — save/restore to avoid leaking into sibling tests.
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
