/**
 * Unit tests for `tray/src/server-manager.ts`.
 *
 * Exercises the public state machine via pre-flight failure paths (no live
 * fork required). For deeper coverage of fork/IPC/restart logic the manual
 * `npm run dev` verification is the source of truth — see plan §Verification.
 */

import * as realFs from "node:fs";
import * as realOs from "node:os";
import * as realPath from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  fsExistsSync: undefined as ((p: unknown) => boolean) | undefined,
  httpGetResult: "refused" as "vaultgate" | "other" | "refused" | "timeout",
  appIsPackaged: false,
  userDataDir: "",
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: string) =>
      mockState.fsExistsSync ? mockState.fsExistsSync(p) : actual.existsSync(p),
    default: actual,
  };
});

vi.mock("node:http", () => ({
  get: (
    _opts: unknown,
    cb: (res: {
      statusCode: number;
      setEncoding: (enc: string) => void;
      on: (event: string, h: (chunk?: string) => void) => void;
    }) => void
  ): { on: (event: string, h: () => void) => unknown; destroy: () => void } => {
    const handlers: Record<string, () => void> = {};
    const req = {
      on(event: string, h: () => void) {
        handlers[event] = h;
        return req;
      },
      destroy() {
        /* no-op */
      },
    };
    queueMicrotask(() => {
      if (mockState.httpGetResult === "vaultgate") {
        // Simulate a VaultGate /health response: HTTP 200 + body "OK"
        const resHandlers: Record<string, (chunk?: string) => void> = {};
        cb({
          statusCode: 200,
          setEncoding: () => {},
          on: (event, h) => { resHandlers[event] = h; },
        });
        resHandlers.data?.("OK");
        resHandlers.end?.();
      } else if (mockState.httpGetResult === "other") {
        // Simulate another service: HTTP 200 + non-"OK" body
        const resHandlers: Record<string, (chunk?: string) => void> = {};
        cb({
          statusCode: 200,
          setEncoding: () => {},
          on: (event, h) => { resHandlers[event] = h; },
        });
        resHandlers.data?.(`{"status":"ok"}`);
        resHandlers.end?.();
      } else if (mockState.httpGetResult === "refused") {
        handlers.error?.();
      } else {
        handlers.timeout?.();
      }
    });
    return req;
  },
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mockState.appIsPackaged;
    },
    getPath: (_kind: string) => mockState.userDataDir,
  },
  utilityProcess: {
    fork: () => {
      throw new Error("utilityProcess.fork should not be reached in unit tests");
    },
  },
}));

// One shared user-data dir for the whole file: server-manager opens an
// async log write stream, and per-test cleanup would race with it.
beforeAll(() => {
  mockState.userDataDir = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), "vaultgate-srv-"));
});

afterAll(() => {
  if (mockState.userDataDir && realFs.existsSync(mockState.userDataDir)) {
    realFs.rmSync(mockState.userDataDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.resetModules();
  mockState.fsExistsSync = undefined;
  mockState.httpGetResult = "refused";
  mockState.appIsPackaged = false;
  // Wipe any previous test's config — the dir is reused.
  const cfg = realPath.join(mockState.userDataDir, "vaultgate-config.json");
  if (realFs.existsSync(cfg)) realFs.unlinkSync(cfg);
});

describe("getState / getLogPath / getIndexState (initial values)", () => {
  it("starts in 'idle' state", async () => {
    const m = await import("../../src/server-manager.js");
    expect(m.getState()).toBe("idle");
  });

  it("returns the userData log file path", async () => {
    const m = await import("../../src/server-manager.js");
    expect(m.getLogPath()).toBe(realPath.join(mockState.userDataDir, "vaultgate.log"));
  });

  it("starts with an idle index state", async () => {
    const m = await import("../../src/server-manager.js");
    expect(m.getIndexState()).toEqual({ type: "state", state: "idle" });
  });
});

describe("start() — pre-flight failures (no fork)", () => {
  function writeConfig(userData: string, patch: Record<string, unknown>): void {
    realFs.writeFileSync(
      realPath.join(userData, "vaultgate-config.json"),
      JSON.stringify({
        vault: "",
        port: 3001,
        obsidianPath: "",
        smartSearchReadyNotified: false,
        ...patch,
      })
    );
  }

  it("transitions to 'obsidian-missing' when no obsidianPath is configured", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "" });
    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("obsidian-missing");
  });

  it("transitions to 'obsidian-missing' when the configured path does not exist", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/nonexistent/obsidian" });
    mockState.fsExistsSync = () => false;
    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("obsidian-missing");
  });

  it("transitions to 'port-conflict' when another service is already on the configured port (regression)", async () => {
    // Bug: previously checkHealth() returned true for any HTTP 200, causing VaultGate to
    // silently "reuse" ports owned by other services (e.g. Perplexity MCP on 3001).
    // Fix: checkHealth() now reads the response body and only returns "vaultgate" for "OK".
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian", port: 3001 });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "other"; // another service is running on port 3001

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("port-conflict");
  });

  it("transitions to 'running' when an existing server already responds on /health", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate";

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("running");
  });

  it("emits a 'state' event for each transition", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "" });
    const m = await import("../../src/server-manager.js");
    const seen: string[] = [];
    m.on("state", (s) => seen.push(s));

    await m.start();
    expect(seen).toEqual(["starting", "obsidian-missing"]);
  });

  it("returns an unsubscribe function from on()", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "" });
    const m = await import("../../src/server-manager.js");
    const seen: string[] = [];
    const unsub = m.on("state", (s) => seen.push(s));
    unsub();

    await m.start();
    expect(seen).toEqual([]);
  });

  it("is idempotent — a second start() while running is a no-op", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate";

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("running");

    // Calling start() again should not change state or throw.
    await m.start();
    expect(m.getState()).toBe("running");
  });
});

describe("stop()", () => {
  it("transitions to 'stopped' when nothing is running", async () => {
    const m = await import("../../src/server-manager.js");
    await m.stop();
    expect(m.getState()).toBe("stopped");
  });
});
