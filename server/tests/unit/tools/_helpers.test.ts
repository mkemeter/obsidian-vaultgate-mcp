import { describe, it, expect } from "vitest";
import { dryRunSchema } from "../../../src/tools/_helpers.js";

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
