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
  childProcessExecFile: undefined as
    | ((cmd: string, args: string[], opts: unknown, cb: (err: Error | null) => void) => void)
    | undefined,
  httpGetResult: "refused" as "ok" | "refused" | "timeout",
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

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: (cmd: string, args: string[], opts: unknown, cb: (err: Error | null) => void) => {
      if (mockState.childProcessExecFile) {
        mockState.childProcessExecFile(cmd, args, opts, cb);
      } else {
        cb(null);
      }
    },
    default: actual,
  };
});

vi.mock("node:http", () => ({
  get: (
    _opts: unknown,
    cb: (res: { statusCode: number; resume: () => void }) => void
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
      if (mockState.httpGetResult === "ok") {
        cb({ statusCode: 200, resume: () => {} });
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
  MessageChannelMain: class {
    port1 = {};
    port2 = { on: () => {}, start: () => {} };
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
  mockState.childProcessExecFile = undefined;
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

  it("transitions to 'cli-not-registered' when the binary fails the version smoke test", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.childProcessExecFile = (_cmd, _args, _opts, cb) => cb(new Error("not a CLI"));

    const m = await import("../../src/server-manager.js");
    await m.start();
    expect(m.getState()).toBe("cli-not-registered");
  });

  it("transitions to 'running' when an existing server already responds on /health", async () => {
    writeConfig(mockState.userDataDir, { obsidianPath: "/Applications/Obsidian" });
    mockState.fsExistsSync = (p) => p === "/Applications/Obsidian";
    mockState.childProcessExecFile = (_cmd, _args, _opts, cb) => cb(null);
    mockState.httpGetResult = "ok";

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
    mockState.childProcessExecFile = (_cmd, _args, _opts, cb) => cb(null);
    mockState.httpGetResult = "ok";

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
