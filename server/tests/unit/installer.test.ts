/**
 * Unit tests for the shell-agnostic installer wrapper.
 *
 * resolveInstallerCommand is pure — platform is passed as an argument, so no mocking
 * is needed. runInstaller spawns a child, so we mock node:child_process's `spawn` to
 * return a fake EventEmitter we can drive with exit/error events.
 *
 * process.platform and process.stdin.isTTY are properties, not functions — mock them
 * with Object.defineProperty, not vi.spyOn.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  capturedCommand: "",
  capturedArgs: [] as string[],
  capturedOptions: {} as Record<string, unknown>,
  // Assigned a fresh EventEmitter in beforeEach — cannot construct one here,
  // as vi.hoisted runs before the EventEmitter import is initialized.
  child: null as unknown as EventEmitter,
}));

vi.mock("node:child_process", () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    mockState.capturedCommand = command;
    mockState.capturedArgs = [...args];
    mockState.capturedOptions = options;
    return mockState.child;
  },
}));

const { resolveInstallerCommand, runInstaller } = await import("../../src/installer.js");

// Save and restore mutable process properties around each test.
const originalPlatform = process.platform;
const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
  vi.resetAllMocks();
  mockState.child = new EventEmitter();
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
});

// ---------------------------------------------------------------------------
// resolveInstallerCommand (pure)
// ---------------------------------------------------------------------------
describe("resolveInstallerCommand", () => {
  it("Windows install → powershell.exe with Bypass/NoProfile and install.ps1", () => {
    const { command, args } = resolveInstallerCommand("install", "win32", "/pkg/deploy");
    expect(command).toBe("powershell.exe");
    expect(args.slice(0, 4)).toEqual(["-ExecutionPolicy", "Bypass", "-NoProfile", "-File"]);
    expect(args[4].endsWith("install.ps1")).toBe(true);
  });

  it("Windows uninstall → uninstall.ps1", () => {
    const { command, args } = resolveInstallerCommand("uninstall", "win32", "/pkg/deploy");
    expect(command).toBe("powershell.exe");
    expect(args[4].endsWith("uninstall.ps1")).toBe(true);
  });

  it("macOS install → bash install.sh", () => {
    const { command, args } = resolveInstallerCommand("install", "darwin", "/pkg/deploy");
    expect(command).toBe("bash");
    expect(args).toHaveLength(1);
    expect(args[0].endsWith("install.sh")).toBe(true);
  });

  it("Linux install → bash install.sh (same as macOS)", () => {
    const { command, args } = resolveInstallerCommand("install", "linux", "/pkg/deploy");
    expect(command).toBe("bash");
    expect(args[0].endsWith("install.sh")).toBe(true);
  });

  it("Linux uninstall → bash uninstall.sh", () => {
    const { command, args } = resolveInstallerCommand("uninstall", "linux", "/pkg/deploy");
    expect(command).toBe("bash");
    expect(args[0].endsWith("uninstall.sh")).toBe(true);
  });

  it("Windows: appends extra args after the ps1 path (order preserved)", () => {
    const { args } = resolveInstallerCommand(
      "install",
      "win32",
      "/pkg/deploy",
      ["-ObsidianPath", "C:\\Obsidian\\Obsidian.exe", "-VaultName", "My Vault", "-NonInteractive"]
    );
    expect(args).toEqual([
      "-ExecutionPolicy",
      "Bypass",
      "-NoProfile",
      "-File",
      expect.stringMatching(/install\.ps1$/),
      "-ObsidianPath",
      "C:\\Obsidian\\Obsidian.exe",
      "-VaultName",
      "My Vault",
      "-NonInteractive",
    ]);
  });

  it("POSIX: appends extra args after the .sh path (forwarded, not interpreted)", () => {
    const { command, args } = resolveInstallerCommand("install", "darwin", "/pkg/deploy", [
      "-NonInteractive",
    ]);
    expect(command).toBe("bash");
    expect(args).toEqual([expect.stringMatching(/install\.sh$/), "-NonInteractive"]);
  });
});

// ---------------------------------------------------------------------------
// runInstaller
// ---------------------------------------------------------------------------
describe("runInstaller", () => {
  it("resolves when the child exits 0", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const p = runInstaller("install");
    mockState.child.emit("exit", 0);
    await expect(p).resolves.toBeUndefined();
    expect(mockState.capturedCommand).toBe("bash");
    expect(mockState.capturedOptions.stdio).toBe("inherit");
  });

  it("rejects with the exit code on a non-zero exit", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const p = runInstaller("install");
    mockState.child.emit("exit", 1);
    await expect(p).rejects.toThrow("install exited with code 1");
  });

  it("rejects with 'unknown' when the child exits with null code", async () => {
    // regression: code ?? "unknown" fallback branch (installer.ts line 105) was never exercised
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const p = runInstaller("install");
    mockState.child.emit("exit", null);
    await expect(p).rejects.toThrow("install exited with code unknown");
  });

  it("rejects with a helpful message when the launcher is not found (ENOENT)", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const p = runInstaller("install");
    mockState.child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    await expect(p).rejects.toThrow('Command not found: "powershell.exe"');
  });

  it("rejects with the raw message on a non-ENOENT spawn error", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const p = runInstaller("uninstall");
    mockState.child.emit("error", Object.assign(new Error("EACCES"), { code: "EACCES" }));
    await expect(p).rejects.toThrow("uninstall failed to start: EACCES");
  });

  it("rejects without spawning when stdin is not a TTY (POSIX)", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    mockState.capturedCommand = "";
    await expect(runInstaller("install")).rejects.toThrow("must be run from a terminal");
    // Guard fired before spawn — command was never captured.
    expect(mockState.capturedCommand).toBe("");
  });

  it("forwards extra args to the spawned child (win32)", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    const p = runInstaller("install", ["-VaultName", "My Vault", "-NonInteractive"]);
    mockState.child.emit("exit", 0);
    await expect(p).resolves.toBeUndefined();
    expect(mockState.capturedCommand).toBe("powershell.exe");
    expect(mockState.capturedArgs.slice(-3)).toEqual([
      "-VaultName",
      "My Vault",
      "-NonInteractive",
    ]);
  });

  it("forwards extra args to the spawned child (posix)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    const p = runInstaller("install", ["-NonInteractive"]);
    mockState.child.emit("exit", 0);
    await expect(p).resolves.toBeUndefined();
    expect(mockState.capturedCommand).toBe("bash");
    expect(mockState.capturedArgs).toEqual([
      expect.stringMatching(/install\.sh$/),
      "-NonInteractive",
    ]);
  });

  it("allows a non-TTY win32 run (PowerShell targets have a -NonInteractive path)", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const p = runInstaller("install", ["-NonInteractive"]);
    mockState.child.emit("exit", 0);
    await expect(p).resolves.toBeUndefined();
    expect(mockState.capturedCommand).toBe("powershell.exe");
  });

  it("allows a non-TTY posix run when -NonInteractive is forwarded", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const p = runInstaller("install", ["-NonInteractive"]);
    mockState.child.emit("exit", 0);
    await expect(p).resolves.toBeUndefined();
    expect(mockState.capturedCommand).toBe("bash");
  });

  it("still rejects a non-TTY posix run WITHOUT -NonInteractive (bare `read` would hang)", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    mockState.capturedCommand = "";
    await expect(runInstaller("install", ["-VaultName", "X"])).rejects.toThrow(
      "must be run from a terminal"
    );
    expect(mockState.capturedCommand).toBe("");
  });
});
