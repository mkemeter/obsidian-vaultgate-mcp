/**
 * Unit tests for `tray/src/port-utils.ts`.
 *
 * `isPortFree` and `findFreePort` use TCP probes. We mock `node:net` so no
 * real sockets are opened during tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Controls how the mock TCP socket behaves in the current test.
const mockSocketResult = vi.hoisted(() => ({
  // Default result for any port without a specific override:
  // "free"    → connection refused  → port is available
  // "taken"   → connection success  → port is in use
  // "timeout" → socket timeout      → treated as free
  value: "free" as "free" | "taken" | "timeout",
  // Per-port overrides, so a test can make one port taken and another free.
  byPort: {} as Record<number, "free" | "taken" | "timeout">,
}));

vi.mock("node:net", () => {
  class MockSocket {
    private handlers: Record<string, () => void> = {};

    setTimeout(_ms: number) { return this; }

    once(event: string, handler: () => void) {
      this.handlers[event] = handler;
      return this;
    }

    destroy() { return this; }

    connect(port: number, _host: string) {
      const state = mockSocketResult.byPort[port] ?? mockSocketResult.value;
      queueMicrotask(() => {
        if (state === "taken") {
          this.handlers["connect"]?.();
        } else if (state === "timeout") {
          this.handlers["timeout"]?.();
        } else {
          this.handlers["error"]?.(); // "free" → connection refused
        }
      });
      return this;
    }
  }

  return { Socket: MockSocket };
});

import { findFreePort, isPortFree } from "../../src/port-utils.js";

beforeEach(() => {
  mockSocketResult.value = "free";
  mockSocketResult.byPort = {};
});

describe("isPortFree", () => {
  it("returns true when the port is free (connection refused)", async () => {
    mockSocketResult.value = "free";
    expect(await isPortFree(3002)).toBe(true);
  });

  it("returns false when another process is listening (connection succeeds)", async () => {
    mockSocketResult.value = "taken";
    expect(await isPortFree(3001)).toBe(false);
  });

  it("returns true on timeout (no response — treat as free)", async () => {
    mockSocketResult.value = "timeout";
    expect(await isPortFree(3003)).toBe(true);
  });
});

describe("findFreePort", () => {
  it("returns the preferred port immediately when it is free", async () => {
    mockSocketResult.value = "free";
    expect(await findFreePort(3002)).toBe(3002);
  });

  it("returns the preferred port even when it equals DEFAULT_PORT and is free", async () => {
    mockSocketResult.value = "free";
    expect(await findFreePort(3002)).toBe(3002);
  });

  it("falls back to the preferred port when all candidates are taken", async () => {
    // All ports appear taken — findFreePort exhausts the search list and falls back.
    mockSocketResult.value = "taken";
    expect(await findFreePort(4000)).toBe(4000);
  });

  it("returns a port from the DEFAULT_PORT range when the preferred port is the same and free", async () => {
    // Healthy path: port 3002 is free, so it is returned immediately.
    mockSocketResult.value = "free";
    const result = await findFreePort(3002);
    expect(result).toBeGreaterThanOrEqual(1024);
    expect(result).toBeLessThanOrEqual(65535);
  });

  it("skips an out-of-range preferred port (< 1024) and selects a valid one", async () => {
    // preferred=80 is a privileged port; it must be skipped rather than returned,
    // so selection falls through to the valid DEFAULT_PORT range.
    mockSocketResult.value = "free";
    const result = await findFreePort(80);
    expect(result).toBeGreaterThanOrEqual(1024);
  });

  it("returns the next candidate when the preferred port is taken", async () => {
    // regression: the fallback search (the whole point of findFreePort) had no
    // test exercising a busy preferred port — only the immediate-return path.
    mockSocketResult.value = "free";
    mockSocketResult.byPort = { 5000: "taken" }; // preferred busy, 3002 free
    expect(await findFreePort(5000)).toBe(3002);
  });

  it("scans forward through the DEFAULT_PORT range, not backward", async () => {
    // regression: the candidate offset must be DEFAULT_PORT + i. A backward scan
    // (DEFAULT_PORT - i) would hand out a lower, unintended port.
    mockSocketResult.value = "free";
    mockSocketResult.byPort = { 5000: "taken", 3002: "taken", 3001: "taken" };
    // preferred(5000) taken → 3002 taken → 3003 (DEFAULT_PORT+1) is the first free.
    expect(await findFreePort(5000)).toBe(3003);
  });

  it("accepts a preferred port exactly at the lower boundary (1024)", async () => {
    // Boundary: 1024 is valid (the guard is `< 1024`, not `<= 1024`).
    mockSocketResult.value = "free";
    expect(await findFreePort(1024)).toBe(1024);
  });

  it("accepts a preferred port exactly at the upper boundary (65535)", async () => {
    // Boundary: 65535 is valid (the guard is `> 65535`, not `>= 65535`).
    mockSocketResult.value = "free";
    expect(await findFreePort(65535)).toBe(65535);
  });

  it("skips an out-of-range preferred port (> 65535)", async () => {
    // regression: a preferred port above the valid range must be skipped, not
    // returned — otherwise the removal of the upper-bound check goes unnoticed.
    mockSocketResult.value = "free";
    const result = await findFreePort(70000);
    expect(result).not.toBe(70000);
    expect(result).toBe(3002);
  });
});
