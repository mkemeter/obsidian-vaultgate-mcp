/**
 * Unit tests for runObsidian().
 *
 * cli.ts uses `util.promisify(execFile)`. The real `execFile` has a
 * [util.promisify.custom] symbol that makes the promise resolve to
 * `{ stdout, stderr }`. Our mock must replicate this so the promisified
 * call returns the same shape.
 */
import { describe, it, expect, vi } from "vitest";
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

/**
 * Start a runObsidian call and immediately reject it with a generic non-zero
 * exit carrying the given stderr (or none). Returns the rejecting promise so a
 * test can assert on the composed error message.
 */
function runObsidianAgainWith(stderr: string | undefined): Promise<string> {
  const p = runObsidian(["search", "query=test"]);
  fail(Object.assign(new Error("exit 1"), stderr === undefined ? {} : { stderr }));
  return p;
}

/** Start a runObsidian call and reject it with a Node execFile timeout shape. */
function runObsidianTimeout(): Promise<string> {
  const p = runObsidian(["search", "query=test"]);
  fail(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" }));
  return p;
}

/** Start a runObsidian call and reject it with a Node maxBuffer-overflow shape. */
function runObsidianMaxBuffer(): Promise<string> {
  const p = runObsidian(["files", "list"]);
  fail(
    Object.assign(new Error("stdout maxBuffer length exceeded"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      killed: true,
      signal: "SIGTERM",
    })
  );
  return p;
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

  it("appends actionable 'Register CLI' guidance to a generic CLI error", async () => {
    // regression: unregistered-CLI runtime failure showed only Obsidian's raw
    // stderr with no hint that the fix is Settings → Register CLI (GH #654 review).
    const p = runObsidian(["search", "query=test"]);
    fail(Object.assign(new Error("exit 1"), { stderr: "some opaque obsidian error" }));
    await expect(p).rejects.toThrow(/some opaque obsidian error/);
    const msg = await runObsidianAgainWith("some opaque obsidian error").catch((e: Error) => e.message);
    // Pin the full hint string to kill StringLiteral mutants on those lines
    expect(msg).toContain("Settings → General → Command line interface → Register CLI.");
  });

  it("still appends guidance when the CLI error has no stderr", async () => {
    // regression: no stderr (empty output) must not swallow the actionable hint.
    const msg = await runObsidianAgainWith(undefined).catch((e: Error) => e.message);
    expect(msg).toContain("Settings → General → Command line interface → Register CLI.");
  });

  it("falls back to err.message when stderr is whitespace-only", async () => {
    // regression: err.stderr?.trim() || err.message (cli.ts line 80) — without .trim(),
    // "   " is truthy and the detail would be "   " instead of the original err.message
    const msg = await runObsidianAgainWith("   ").catch((e: Error) => e.message);
    expect(msg).toContain("exit 1");
    expect(msg).not.toContain("   ");
  });

  it("throws a helpful error when binary is not found (ENOENT)", async () => {
    const p = runObsidian(["help"]);
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow("Obsidian CLI binary not found");
    // Verify the full actionable hint is included (kills StringLiteral mutants on those lines)
    const p2 = runObsidian(["help"]);
    fail(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const err2 = await p2.catch((e: Error) => e.message);
    expect(err2).toContain("OBSIDIAN_CLI_PATH");
    expect(err2).toContain("enable the CLI in Obsidian");
  });

  it("reports a timeout distinctly, not as a 'Register CLI' error", async () => {
    // regression: execFile timeout does NOT set code='ETIMEDOUT' — it kills the
    // child (killed=true, signal='SIGTERM', code null). The old generic branch
    // mislabeled this as an unregistered-CLI error.
    const p = runObsidian(["search", "query=test"]);
    fail(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGTERM" }));
    const msg = await p.catch((e: Error) => e.message);
    // Pin the exact hint string to kill StringLiteral mutants on that line
    expect(msg).toContain("Check that Obsidian is running and responsive, then try again.");
    await expect(runObsidianTimeout()).rejects.not.toThrow(/Register CLI/);
  });

  it("reports a maxBuffer overflow distinctly — and NOT as a timeout", async () => {
    // regression: maxBuffer overflow ALSO sets killed=true/signal=SIGTERM, so the
    // buffer check must precede the timeout check or a large listing is misreported
    // as an unresponsive-Obsidian timeout.
    const p = runObsidian(["files", "list"]);
    fail(
      Object.assign(new Error("stdout maxBuffer length exceeded"), {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        killed: true,
        signal: "SIGTERM",
      })
    );
    const msg = await p.catch((e: Error) => e.message);
    // Pin the exact hint string to kill StringLiteral mutants on that line
    expect(msg).toContain("Narrow the request (e.g. add a limit= argument) and try again.");
    await expect(runObsidianMaxBuffer()).rejects.not.toThrow(/timed out/i);
    await expect(runObsidianMaxBuffer()).rejects.not.toThrow(/Register CLI/);
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
