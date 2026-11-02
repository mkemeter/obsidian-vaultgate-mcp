/**
 * Tests for the CLI access guard infrastructure:
 * installAccessGuard, isCliWriteCommand, extractNotePath, and guard
 * invocation behaviour in runObsidian.
 *
 * Tests that require runObsidian use vi.resetModules() in beforeEach so
 * _accessGuard module state is cleared between tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promisify } from "node:util";

vi.mock("../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));

// Simple execFile mock that resolves immediately.
const execFileCalled = vi.hoisted(() => ({ count: 0 }));
const fakeExecFile = Object.assign(
  (_bin: string, _args: string[], _opts: object, _cb: Function) => {},
  {
    [promisify.custom]: (_bin: string, _args: string[], _opts: object) => {
      execFileCalled.count++;
      return Promise.resolve({ stdout: "ok", stderr: "" });
    },
  }
);

vi.mock("node:child_process", () => ({ execFile: fakeExecFile }));

beforeEach(() => {
  execFileCalled.count = 0;
});

// ---------------------------------------------------------------------------
// Pure helpers — no module state, no resets needed
// ---------------------------------------------------------------------------

const { isCliWriteCommand } = await import("../../src/cli.js");
const { extractNotePath } = await import("../../src/cli.js");

describe("isCliWriteCommand", () => {
  it("returns true for create", () => {
    expect(isCliWriteCommand(["create", "name=Note.md"])).toBe(true);
  });

  it("returns true for append", () => {
    expect(isCliWriteCommand(["append", "path=Note.md", "content=x"])).toBe(true);
  });

  it("returns true for prepend", () => {
    expect(isCliWriteCommand(["prepend", "path=Note.md", "content=x"])).toBe(true);
  });

  it("returns true for delete", () => {
    expect(isCliWriteCommand(["delete", "path=Note.md"])).toBe(true);
  });

  it("returns true for daily:append", () => {
    expect(isCliWriteCommand(["daily:append", "content=x"])).toBe(true);
  });

  it("returns true for property:set", () => {
    expect(isCliWriteCommand(["property:set", "path=Note.md", "key=k", "value=v"])).toBe(true);
  });

  it("returns true for eval", () => {
    expect(isCliWriteCommand(["eval", "script=x"])).toBe(true);
  });

  it("returns true for plugin:reload", () => {
    expect(isCliWriteCommand(["plugin:reload", "id=p"])).toBe(true);
  });

  it("returns true for dev:screenshot", () => {
    expect(isCliWriteCommand(["dev:screenshot"])).toBe(true);
  });

  it("returns true for dev:mobile", () => {
    expect(isCliWriteCommand(["dev:mobile"])).toBe(true);
  });

  it("returns true for templates apply", () => {
    expect(isCliWriteCommand(["templates", "apply", "name=MyTemplate"])).toBe(true);
  });

  it("returns false for read", () => {
    expect(isCliWriteCommand(["read", "path=Note.md"])).toBe(false);
  });

  it("returns false for files list", () => {
    expect(isCliWriteCommand(["files", "list"])).toBe(false);
  });

  it("returns false for search", () => {
    expect(isCliWriteCommand(["search", "query=hello"])).toBe(false);
  });

  it("returns false for backlinks", () => {
    expect(isCliWriteCommand(["backlinks", "path=Note.md"])).toBe(false);
  });

  it("returns false for empty args", () => {
    expect(isCliWriteCommand([])).toBe(false);
  });
});

describe("extractNotePath", () => {
  it("extracts path= argument", () => {
    expect(extractNotePath(["read", "path=Work/Note.md"])).toBe("Work/Note.md");
  });

  it("extracts name= argument when path= is absent", () => {
    expect(extractNotePath(["create", "name=New Note.md"])).toBe("New Note.md");
  });

  it("prefers path= over name= when both are present", () => {
    expect(extractNotePath(["read", "path=A.md", "name=B.md"])).toBe("A.md");
  });

  it("returns undefined for list operations", () => {
    expect(extractNotePath(["files", "list"])).toBeUndefined();
  });

  it("returns undefined when no path or name argument is present", () => {
    expect(extractNotePath(["backlinks", "file=MyNote"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Guard invocation — requires module resets to clear _accessGuard state
// ---------------------------------------------------------------------------

describe("access guard in runObsidian", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("executes normally when no guard is installed", async () => {
    const { runObsidian } = await import("../../src/cli.js");
    await runObsidian(["read", "path=Note.md"]);
    expect(execFileCalled.count).toBe(1);
  });

  it("executes normally when guard is installed and does not throw", async () => {
    const { runObsidian, installAccessGuard } = await import("../../src/cli.js");
    const guardCalls: string[][] = [];
    installAccessGuard((args) => {
      guardCalls.push(args);
    });
    await runObsidian(["read", "path=Note.md"]);
    expect(execFileCalled.count).toBe(1);
    expect(guardCalls).toEqual([["read", "path=Note.md"]]);
  });

  it("blocks the CLI call when guard throws", async () => {
    const { runObsidian, installAccessGuard } = await import("../../src/cli.js");
    installAccessGuard(() => {
      throw new Error("access denied");
    });
    await expect(runObsidian(["read", "path=Work/Secret.md"])).rejects.toThrow("access denied");
    expect(execFileCalled.count).toBe(0);
  });

  it("awaits an async guard before proceeding", async () => {
    const { runObsidian, installAccessGuard } = await import("../../src/cli.js");
    const order: string[] = [];
    installAccessGuard(async () => {
      await Promise.resolve();
      order.push("guard");
    });
    const p = runObsidian(["read", "path=Note.md"]);
    await p;
    order.push("after");
    expect(order[0]).toBe("guard");
    expect(execFileCalled.count).toBe(1);
  });

  it("async guard rejection blocks CLI call", async () => {
    const { runObsidian, installAccessGuard } = await import("../../src/cli.js");
    installAccessGuard(async () => {
      throw new Error("async access denied");
    });
    await expect(runObsidian(["create", "name=Note.md"])).rejects.toThrow("async access denied");
    expect(execFileCalled.count).toBe(0);
  });

  it("runObsidianAdmin bypasses the guard entirely", async () => {
    const { runObsidianAdmin, installAccessGuard } = await import("../../src/cli.js");
    let guardCalled = false;
    installAccessGuard(() => {
      guardCalled = true;
      throw new Error("should not fire");
    });
    await runObsidianAdmin(["files", "list"]);
    expect(guardCalled).toBe(false);
    expect(execFileCalled.count).toBe(1);
  });
});
