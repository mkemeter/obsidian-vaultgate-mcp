/**
 * Unit tests for runObsidian().
 *
 * cli.ts uses `util.promisify(execFile)`. The real `execFile` has a
 * [util.promisify.custom] symbol that makes the promise resolve to
 * `{ stdout, stderr }`. Our mock must replicate this so the promisified
 * call returns the same shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promisify } from "node:util";

vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

// Mutable state shared between the mock and the per-test helpers.
// The mock factory and the hoisted reference must agree on the same object.
const mockState = vi.hoisted(() => ({
  resolve: (_stdout: string, _stderr: string) => {},
  reject: (_err: unknown) => {},
  capturedBin: "",
  capturedArgs: [] as string[],
}));

// A function with the custom promisify symbol returning { stdout, stderr }.
// This matches the real execFile's promise shape.
const fakeExecFile = Object.assign(
  // The callback-style signature (never actually called by promisify due to custom)
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

// Import AFTER mocks are in place.
const { runObsidian } = await import("../../src/cli.js");

/** Resolve the pending execFile promise with stdout. */
function succeed(stdout = ""): void {
  mockState.resolve(stdout, "");
}

/** Reject the pending execFile promise with an error. */
function fail(err: Error): void {
  mockState.reject(err);
}

describe("runObsidian", () => {
  it("returns trimmed stdout on success", async () => {
    const p = runObsidian(["files", "list"]);
    succeed("  file1.md\nfile2.md\n  ");
    expect(await p).toBe("file1.md\nfile2.md");
  });

  it("throws with stderr content on non-zero exit", async () => {
    const p = runObsidian(["search", "query=test"]);
    fail(Object.assign(new Error("exit 1"), { stderr: "command not found" }));
    await expect(p).rejects.toThrow("Obsidian CLI error: command not found");
  });

  it("throws a helpful error when binary is not found (ENOENT)", async () => {
    const p = runObsidian(["help"]);
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow("Obsidian CLI binary not found");
  });

  it("does NOT prepend vault arg when config.vault is unset", async () => {
    const p = runObsidian(["search", "query=hello"]);
    succeed();
    await p;
    expect(mockState.capturedArgs).toEqual(["search", "query=hello"]);
    expect(mockState.capturedArgs[0]).not.toMatch(/^vault=/);
  });

  it("passes args as an array (no shell expansion)", async () => {
    const maliciousArg = "name=test; rm -rf /";
    const p = runObsidian(["create", maliciousArg]);
    succeed();
    await p;
    expect(Array.isArray(mockState.capturedArgs)).toBe(true);
    expect(mockState.capturedArgs[1]).toBe(maliciousArg);
  });

  it("calls the binary with correct path", async () => {
    const p = runObsidian(["help"]);
    succeed();
    await p;
    expect(mockState.capturedBin).toBe("obsidian");
  });
});

describe("runObsidian with vault configured", () => {
  it("prepends vault=<name> as the first argument when vault is configured", async () => {
    vi.doMock("../../src/config.js", () => ({
      config: { vault: "MyVault", cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
    }));
    vi.resetModules(); // clear module cache so the next import uses the new config mock

    const { runObsidian: runWithVault } = await import("../../src/cli.js");

    const p = runWithVault(["search", "query=hello"]);
    succeed();
    await p;

    expect(mockState.capturedArgs[0]).toBe("vault=MyVault");
    expect(mockState.capturedArgs[1]).toBe("search");

    vi.doUnmock("../../src/config.js");
  });
});
