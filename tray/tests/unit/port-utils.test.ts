/**
 * Unit tests for `tray/src/port-utils.ts`.
 *
 * `isPortFree` and `findFreePort` use TCP probes. We mock `node:net` so no
 * real sockets are opened during tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Controls how the mock TCP socket behaves in the current test.
const mockSocketResult = vi.hoisted(() => ({
  // "free"    → connection refused  → port is available
  // "taken"   → connection success  → port is in use
  // "timeout" → socket timeout      → treated as free
  value: "free" as "free" | "taken" | "timeout",
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

    connect(_port: number, _host: string) {
      queueMicrotask(() => {
        if (mockSocketResult.value === "taken") {
          this.handlers["connect"]?.();
        } else if (mockSocketResult.value === "timeout") {
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
});
