/**
 * Unit tests for `tray/src/update-check.ts`.
 *
 * Covers the semver comparator, the registry round-trip, the listener
 * fan-out, and the silent-failure contract on network errors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
  },
}));

let originalFetch: typeof globalThis.fetch | undefined;

beforeEach(async () => {
  vi.resetModules();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

describe("checkOnce", () => {
  it("notifies listeners and stores the latest version when registry returns a newer one", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.2.0" }),
    } as unknown as Response);

    const { checkOnce, getLatestUpdate, onUpdateAvailable } = await import(
      "../../src/update-check.js"
    );
    const seen: string[] = [];
    onUpdateAvailable((v) => seen.push(v));

    await checkOnce();

    expect(seen).toEqual(["0.2.0"]);
    expect(getLatestUpdate()).toBe("0.2.0");
  });

  it("does not notify when registry returns the current version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.1.0" }),
    } as unknown as Response);

    const { checkOnce, getLatestUpdate, onUpdateAvailable } = await import(
      "../../src/update-check.js"
    );
    const seen: string[] = [];
    onUpdateAvailable((v) => seen.push(v));

    await checkOnce();

    expect(seen).toEqual([]);
    expect(getLatestUpdate()).toBeUndefined();
  });

  it("does not notify when registry returns an older version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.0.9" }),
    } as unknown as Response);

    const { checkOnce, onUpdateAvailable } = await import("../../src/update-check.js");
    const seen: string[] = [];
    onUpdateAvailable((v) => seen.push(v));

    await checkOnce();

    expect(seen).toEqual([]);
  });

  it("is silent on a non-OK HTTP response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ version: "9.9.9" }),
    } as unknown as Response);

    const { checkOnce, getLatestUpdate } = await import("../../src/update-check.js");
    await expect(checkOnce()).resolves.toBeUndefined();
    expect(getLatestUpdate()).toBeUndefined();
  });

  it("is silent when the registry response has no version field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response);

    const { checkOnce, getLatestUpdate } = await import("../../src/update-check.js");
    await expect(checkOnce()).resolves.toBeUndefined();
    expect(getLatestUpdate()).toBeUndefined();
  });

  it("is silent on a network error / abort", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const { checkOnce, getLatestUpdate } = await import("../../src/update-check.js");
    await expect(checkOnce()).resolves.toBeUndefined();
    expect(getLatestUpdate()).toBeUndefined();
  });
});

describe("onUpdateAvailable", () => {
  it("immediately fires with the cached version for late subscribers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.5.0" }),
    } as unknown as Response);

    const { checkOnce, onUpdateAvailable } = await import("../../src/update-check.js");
    await checkOnce();

    const seen: string[] = [];
    onUpdateAvailable((v) => seen.push(v));

    expect(seen).toEqual(["0.5.0"]);
  });

  it("returns an unsubscribe function that prevents further notifications", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: "0.3.0" }),
    } as unknown as Response);

    const { checkOnce, onUpdateAvailable } = await import("../../src/update-check.js");
    const seen: string[] = [];
    const unsubscribe = onUpdateAvailable((v) => seen.push(v));
    unsubscribe();

    await checkOnce();
    expect(seen).toEqual([]);
  });
});

describe("isNewer (semver comparator, exercised through checkOnce)", () => {
  async function compareVersions(local: string, remote: string): Promise<boolean> {
    const electron = await import("electron");
    vi.mocked(electron.app.getVersion).mockReturnValue(local);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: remote }),
    } as unknown as Response);
    const { checkOnce, getLatestUpdate } = await import("../../src/update-check.js");
    await checkOnce();
    return getLatestUpdate() !== undefined;
  }

  it("treats higher major version as newer", async () => {
    expect(await compareVersions("1.9.9", "2.0.0")).toBe(true);
  });

  it("treats higher minor version as newer", async () => {
    expect(await compareVersions("1.1.0", "1.2.0")).toBe(true);
  });

  it("treats higher patch version as newer", async () => {
    expect(await compareVersions("1.1.1", "1.1.2")).toBe(true);
  });

  it("ignores leading 'v' prefix", async () => {
    expect(await compareVersions("v1.0.0", "v1.0.1")).toBe(true);
  });

  it("strips pre-release suffix and compares the numeric core", async () => {
    expect(await compareVersions("1.0.0", "1.0.1-beta.1")).toBe(true);
  });

  it("treats equal versions as not newer", async () => {
    expect(await compareVersions("1.2.3", "1.2.3")).toBe(false);
  });

  it("treats lower remote version as not newer", async () => {
    expect(await compareVersions("2.0.0", "1.9.9")).toBe(false);
  });

  it("handles versions with different segment counts (1.0 vs 1.0.0)", async () => {
    expect(await compareVersions("1.0", "1.0.1")).toBe(true);
  });
});
