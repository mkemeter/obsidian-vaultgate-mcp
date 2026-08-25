import { describe, it, expect } from "vitest";
import {
  DEFAULT_INJECT_INTERVAL,
  MIN_INJECT_INTERVAL,
  MAX_INJECT_INTERVAL,
  isValidInterval,
  normalizeInterval,
} from "../../src/inject-interval.js";

describe("isValidInterval", () => {
  it("accepts valid integers within range", () => {
    expect(isValidInterval(1)).toBe(true);
    expect(isValidInterval(30)).toBe(true);
    expect(isValidInterval(3600)).toBe(true);
  });

  it("accepts numeric strings within range", () => {
    expect(isValidInterval("1")).toBe(true);
    expect(isValidInterval("60")).toBe(true);
    expect(isValidInterval("3600")).toBe(true);
  });

  it("rejects values below minimum", () => {
    expect(isValidInterval(0)).toBe(false);
    expect(isValidInterval(-1)).toBe(false);
    expect(isValidInterval("0")).toBe(false);
  });

  it("rejects values above maximum", () => {
    expect(isValidInterval(3601)).toBe(false);
    expect(isValidInterval("9999")).toBe(false);
  });

  it("rejects non-integer numbers", () => {
    expect(isValidInterval(1.5)).toBe(false);
    expect(isValidInterval(30.9)).toBe(false);
  });

  it("rejects NaN, undefined, null, and strings", () => {
    expect(isValidInterval(Number.NaN)).toBe(false);
    expect(isValidInterval(undefined)).toBe(false);
    expect(isValidInterval(null)).toBe(false);
    expect(isValidInterval("abc")).toBe(false);
    expect(isValidInterval("")).toBe(false);
  });
});

describe("normalizeInterval", () => {
  it("returns the default when undefined", () => {
    expect(normalizeInterval(undefined)).toBe(DEFAULT_INJECT_INTERVAL);
  });

  it("returns the default when empty string", () => {
    expect(normalizeInterval("")).toBe(DEFAULT_INJECT_INTERVAL);
  });

  it("parses a valid numeric string", () => {
    expect(normalizeInterval("60")).toBe(60);
    expect(normalizeInterval("1")).toBe(MIN_INJECT_INTERVAL);
    expect(normalizeInterval("3600")).toBe(MAX_INJECT_INTERVAL);
  });

  it("accepts a valid number directly", () => {
    expect(normalizeInterval(120)).toBe(120);
  });

  it("truncates floats to integers", () => {
    expect(normalizeInterval(30.9)).toBe(DEFAULT_INJECT_INTERVAL); // 30.9 truncated = 30, valid
    expect(normalizeInterval(1.1)).toBe(1);
  });

  it("falls back to default for out-of-range values", () => {
    expect(normalizeInterval(0)).toBe(DEFAULT_INJECT_INTERVAL);
    expect(normalizeInterval(3601)).toBe(DEFAULT_INJECT_INTERVAL);
    expect(normalizeInterval("abc")).toBe(DEFAULT_INJECT_INTERVAL);
  });
});
