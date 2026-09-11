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

type HealthResult = "vaultgate" | "other" | "refused" | "timeout";

const mockState = vi.hoisted(() => ({
  fsExistsSync: undefined as ((p: unknown) => boolean) | undefined,
  httpGetResult: "refused" as HealthResult,
  // Per-port override — the superseded-start regression test needs port 3001
  // to keep failing while port 3002 answers, from one shared http.get mock.
  httpGetResultByPort: {} as Record<number, HealthResult>,
  // Fake utilityProcess child returned by fork() when set (bug 7 test).
  fakeChild: undefined as unknown,
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
    _opts: { port?: number },
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
      const result =
        mockState.httpGetResultByPort[_opts.port ?? -1] ?? mockState.httpGetResult;
      if (result === "vaultgate") {
        // Simulate a VaultGate /health response: HTTP 200 + body "OK"
        const resHandlers: Record<string, (chunk?: string) => void> = {};
        cb({
          statusCode: 200,
          setEncoding: () => {},
          on: (event, h) => { resHandlers[event] = h; },
        });
        resHandlers.data?.("OK");
        resHandlers.end?.();
      } else if (result === "other") {
        // Simulate another service: HTTP 200 + non-"OK" body
        const resHandlers: Record<string, (chunk?: string) => void> = {};
        cb({
          statusCode: 200,
          setEncoding: () => {},
          on: (event, h) => { resHandlers[event] = h; },
        });
        resHandlers.data?.(`{"status":"ok"}`);
        resHandlers.end?.();
      } else if (result === "refused") {
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
      // The superseded-start regression test installs a controllable fake
      // child; every other test keeps the historical "should not fork" guard.
      if (mockState.fakeChild) return mockState.fakeChild;
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
  mockState.httpGetResultByPort = {};
  mockState.fakeChild = undefined;
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

  it("transitions to 'running-external' when an existing (unmanaged) server responds on /health", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate";

    const m = await import("../../src/server-manager.js");
    await m.start();
    // Updated in the bug 5 fix round: an adopted external server is
    // UNMANAGED, so it must not report the managed "running" state.
    expect(m.getState()).toBe("running-external");
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

  it("is idempotent — a second start() while running/running-external is a no-op", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate";

    const m = await import("../../src/server-manager.js");
    await m.start();
    // Updated in the bug 5 fix round: reuse reports the unmanaged state.
    expect(m.getState()).toBe("running-external");

    // Calling start() again should not change state or throw.
    await m.start();
    expect(m.getState()).toBe("running-external");
  });
});

describe("stop()", () => {
  it("transitions to 'stopped' when nothing is running", async () => {
    const m = await import("../../src/server-manager.js");
    await m.stop();
    expect(m.getState()).toBe("stopped");
  });
});

/**
 * Writes a test config file into the (shared, real) user-data dir. Defaults
 * mirror the app's first-run config; `patch` overrides individual fields.
 * Shared by every describe that exercises start()'s pre-flight (function
 * declarations hoist, so use in earlier describes is safe).
 */
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

// ---------------------------------------------------------------------------
// Fake utilityProcess child — just enough surface for server-manager:
// stdout/stderr .on(), message/exit wiring, postMessage, kill().
// kill() emits "exit" exactly once (asynchronously), like a real dying
// process; a second kill() is a no-op.
// ---------------------------------------------------------------------------

function makeFakeChild() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const onceListeners: Array<[string, (...args: unknown[]) => void]> = [];
  let exited = false;

  const emit = (event: string, ...args: unknown[]): void => {
    for (const h of listeners[event] ?? []) h(...args);
    for (let i = onceListeners.length - 1; i >= 0; i -= 1) {
      const entry = onceListeners[i];
      if (entry && entry[0] === event) {
        onceListeners.splice(i, 1);
        entry[1](...args);
      }
    }
  };

  return {
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (event: string, h: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(h);
    },
    once: (event: string, h: (...args: unknown[]) => void) => {
      onceListeners.push([event, h]);
    },
    postMessage: vi.fn(),
    kill: () => {
      if (exited) return;
      exited = true;
      queueMicrotask(() => emit("exit", 0));
    },
  };
}

// ---------------------------------------------------------------------------
// regression: a superseded start() must not flip state to "error" after an
// intentional restart (stale /health-polling coroutine bug)
// ---------------------------------------------------------------------------

describe("regression: superseded start() after an intentional restart", () => {
  it("keeps 'running-external' when the previous failed start() times out after a port change + reuse", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      writeConfig(mockState.userDataDir, {
        obsidianPath: "/Applications/Obsidian",
        port: 3001,
      });
      mockState.fsExistsSync = (p: unknown) =>
        p === "/Applications/Obsidian" || String(p).endsWith("server/build/index.js");
      // Port 3001 never answers /health (the forked "server" never comes up).
      mockState.httpGetResultByPort = { 3001: "refused" };
      mockState.fakeChild = makeFakeChild();

      const m = await import("../../src/server-manager.js");

      // start() #1: passes pre-flight, forks the fake child, then polls
      // /health on 3001 — which never responds.
      void m.start();
      await vi.advanceTimersByTimeAsync(300);
      expect(m.getState()).toBe("starting");

      // Intentional stop — the forked child is killed and exits; the
      // exit handler must NOT restart (state is "stopped").
      await m.stop();
      expect(m.getState()).toBe("stopped");

      // The user changes the port in Preferences; 3002 already serves
      // VaultGate → the new start() takes the REUSE path (no fork).
      // Updated in the bug 5 fix round: the reused server is external, so
      // the honest state is "running-external" (not the managed "running").
      writeConfig(mockState.userDataDir, {
        obsidianPath: "/Applications/Obsidian",
        port: 3002,
      });
      mockState.httpGetResultByPort = { 3001: "refused", 3002: "vaultgate" };
      await m.start();
      expect(m.getState()).toBe("running-external");

      // The old start() #1 coroutine is still inside its 5 s /health deadline
      // for port 3001. Let it elapse — its timeout is a stale failure of a
      // process that was intentionally stopped, and must NOT flip state to
      // "error" on top of the healthy, running (reused) server.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(m.getState()).toBe("running-external");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// CHARACTERIZATION PIN (bug 5 — post-fix contract)
//
// This test originally pinned the PRE-FIX, buggy behavior of "reuse mode":
// an external VaultGate server on the configured port reported the managed
// "running" state and vault/injection/index commands silently no-oped.
//
// It has been REWRITTEN in the fix round to pin the approved contract:
// reusing an EXTERNAL server makes it UNMANAGED — a distinct
// `running-external` state, managed-only commands no-op WITH a logged
// explanation, and the external process is never touched.
// ---------------------------------------------------------------------------

describe("characterization pin: external-server reuse (bug 5, post-fix contract)", () => {
  it("reuse-mode start() reports 'running-external' and managed commands no-op with a log", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian", port: 3001 });
    mockState.fsExistsSync = (p: unknown) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate"; // an external VaultGate answers /health

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("running-external");

    const logs: string[] = [];
    const unsub = m.on("log", (line: string) => logs.push(line));
    m.sendVaultChange("ProjectVault");
    unsub();

    // No child process was forked — the external server is left untouched,
    // and the no-op is now logged (and surfaced via the UI state) instead of
    // being silent.
    expect(m.getState()).toBe("running-external");
    expect(logs.some((l) => l.includes("no child process"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG 5 REGRESSION — the TDD target for the approved contract: reusing an
// EXTERNAL server makes it UNMANAGED. The tray must report a distinct
// `running-external` state (honest labels, disabled controls, Preferences
// warning) instead of the managed `running` state, and never kill the
// external process.
//
// Was RED before the fix round (start() reported "running"); green since the
// `running-external` state landed.
// ---------------------------------------------------------------------------

describe("bug 5 regression: external-server reuse must report the unmanaged state", () => {
  it("reports 'running-external' — never the managed 'running' — when start() adopts an existing server", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian", port: 3001 });
    mockState.fsExistsSync = (p: unknown) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate"; // an external VaultGate answers /health

    const m = await import("../../src/server-manager.js");
    await m.start();

    // Regression: "running" — the tray would show enabled controls for a
    // process it does not own.
    expect(m.getState()).toBe("running-external");

    // A managed-only command that silently no-ops must not disturb the
    // unmanaged state either.
    m.sendVaultChange("ProjectVault");
    expect(m.getState()).toBe("running-external");
  });

  it("stop() in 'running-external' is a logged no-op — state stays, no fork, no kill", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian", port: 3001 });
    mockState.fsExistsSync = (p: unknown) => p === "/Applications/Obsidian";
    mockState.httpGetResult = "vaultgate"; // an external VaultGate answers /health

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("running-external");

    const logs: string[] = [];
    const unsub = m.on("log", (line: string) => logs.push(line));
    await m.stop();
    unsub();

    // The external server is still serving on the port — the state must not
    // flip to "stopped" (that would lie), and no process of ours exists to
    // kill. A subsequent start() must remain a no-op: the fork mock throws if
    // reached, so this also proves we never spawn a second server on a port
    // an external instance already owns.
    expect(m.getState()).toBe("running-external");
    expect(logs.some((l) => l.includes("not managed"))).toBe(true);
    await m.start();
    expect(m.getState()).toBe("running-external");
  });
});
