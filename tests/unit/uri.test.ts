/**
 * Unit tests for openUri() and runUri().
 *
 * uri.ts uses `util.promisify(execFile)`. The real `execFile` has a
 * [util.promisify.custom] symbol that makes the promise resolve to
 * `{ stdout, stderr }`. Our mock must replicate this so the promisified
 * call returns the same shape — same pattern as cli.test.ts.
 *
 * process.platform is a string property, not a function — mock it with
 * Object.defineProperty, not vi.spyOn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promisify } from "node:util";

vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

const mockState = vi.hoisted(() => ({
  resolve: (_stdout: string, _stderr: string) => {},
  reject: (_err: unknown) => {},
  capturedBin: "",
  capturedArgs: [] as string[],
}));

const fakeExecFile = Object.assign(
  (_bin: string, _args: string[], _opts: object, _cb: Function) => {},
  {
    [promisify.custom]: (bin: string, args: string[], _opts: object) => {
      mockState.capturedBin = bin;
      mockState.capturedArgs = [...args];
      return new Promise<{ stdout: string; stderr: string }>((res, rej) => {
        mockState.resolve = (stdout, stderr) => res({ stdout, stderr });
        mockState.reject = rej;
      });
    },
  }
);

vi.mock("node:child_process", () => ({
  execFile: fakeExecFile,
}));

const { openUri, runUri } = await import("../../src/uri.js");

function succeed(): void {
  mockState.resolve("", "");
}

function fail(err: Error): void {
  mockState.reject(err);
}

// Save and restore process.platform around each test.
const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
});

// ---------------------------------------------------------------------------
// openUri
// ---------------------------------------------------------------------------
describe("openUri — macOS", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  it("dispatches open [uri]", async () => {
    const p = openUri("obsidian://open?file=Test");
    succeed();
    await p;
    expect(mockState.capturedBin).toBe("open");
    expect(mockState.capturedArgs).toEqual(["obsidian://open?file=Test"]);
  });

  it("throws with launcher name on ENOENT", async () => {
    const p = openUri("obsidian://open?file=Test");
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow('URI launcher not found: "open"');
  });

  it("throws with stderr detail on non-ENOENT failure", async () => {
    const p = openUri("obsidian://open?file=Test");
    fail(Object.assign(new Error("exit 1"), { stderr: "permission denied" }));
    await expect(p).rejects.toThrow("URI open error: permission denied");
  });
});

describe("openUri — Linux", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  });

  it("dispatches xdg-open [uri]", async () => {
    const p = openUri("obsidian://open?file=Test");
    succeed();
    await p;
    expect(mockState.capturedBin).toBe("xdg-open");
    expect(mockState.capturedArgs).toEqual(["obsidian://open?file=Test"]);
  });

  it("throws with launcher name on ENOENT", async () => {
    const p = openUri("obsidian://open?file=Test");
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow('URI launcher not found: "xdg-open"');
  });
});

describe("openUri — Windows", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });

  it("dispatches cmd /c start '' uri with 4-element args array", async () => {
    const p = openUri("obsidian://open?file=Test");
    succeed();
    await p;
    expect(mockState.capturedBin).toBe("cmd");
    expect(mockState.capturedArgs).toEqual(["/c", "start", "", "obsidian://open?file=Test"]);
  });

  it("throws with launcher name on ENOENT", async () => {
    const p = openUri("obsidian://open?file=Test");
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow('URI launcher not found: "cmd"');
  });
});

// ---------------------------------------------------------------------------
// runUri
// ---------------------------------------------------------------------------
describe("runUri", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  it("builds correct URI with encodeURIComponent (spaces → %20, not +)", async () => {
    const p = runUri("open", { file: "My Note.md" });
    succeed();
    await p;
    expect(mockState.capturedArgs[0]).toContain("file=My%20Note.md");
    expect(mockState.capturedArgs[0]).not.toContain("+");
  });

  it("produces bare obsidian://daily with no vault and no params", async () => {
    const p = runUri("daily", {});
    succeed();
    await p;
    expect(mockState.capturedArgs[0]).toBe("obsidian://daily");
  });

  it("URI is passed as a single array element (no shell expansion)", async () => {
    const p = runUri("search", { query: "hello world" });
    succeed();
    await p;
    expect(mockState.capturedArgs).toHaveLength(1);
  });
});

describe("runUri with vault configured", () => {
  it("injects vault prefix first, caller params follow", async () => {
    vi.doMock("../../src/config.js", () => ({
      config: { vault: "MyVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.resetModules();

    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    const { runUri: runWithVault } = await import("../../src/uri.js");

    const p = runWithVault("open", { file: "Note.md" });
    succeed();
    await p;

    const uri = mockState.capturedArgs[0];
    expect(uri).toContain("vault=MyVault");
    expect(uri).toContain("file=Note.md");
    // vault must appear before file in query string
    expect(uri.indexOf("vault=")).toBeLessThan(uri.indexOf("file="));

    vi.doUnmock("../../src/config.js");
  });
});
