import { describe, it, expect } from "vitest";
import { parseIpcMessage } from "../../src/ipc.js";

/**
 * Contract tests for the tray → server IPC boundary.
 *
 * The "accepts" cases mirror the EXACT payloads the tray builds in
 * `tray/src/server-manager.ts` (`sendVaultChange`, `sendInjectionConfig`,
 * `sendControlCommand`). If the tray's send shape ever drifts from what the
 * server accepts, one of these fails — the guard against the class of bug where
 * an IPC message is silently dropped or misinterpreted.
 */
describe("parseIpcMessage — accepts real tray payloads", () => {
  it("parses a vault-only config change (sendVaultChange)", () => {
    const result = parseIpcMessage({ __vaultgate_config__: { vault: "MyVault" } });
    expect(result).toEqual({ kind: "config", patch: { vault: "MyVault" } });
  });

  it("parses an injection-config change (sendInjectionConfig)", () => {
    const result = parseIpcMessage({
      __vaultgate_config__: { injectConventions: true, injectIntervalSecs: 30 },
    });
    expect(result).toEqual({
      kind: "config",
      patch: { injectConventions: true, injectIntervalSecs: 30 },
    });
  });

  it("parses a disabled injection-config change", () => {
    const result = parseIpcMessage({
      __vaultgate_config__: { injectConventions: false, injectIntervalSecs: 60 },
    });
    expect(result).toEqual({
      kind: "config",
      patch: { injectConventions: false, injectIntervalSecs: 60 },
    });
  });

  it("parses a rebuild_index control command (sendControlCommand)", () => {
    expect(parseIpcMessage({ __vaultgate_control__: { command: "rebuild_index" } })).toEqual({
      kind: "control",
      command: "rebuild_index",
    });
  });

  it("parses a clear_index control command", () => {
    expect(parseIpcMessage({ __vaultgate_control__: { command: "clear_index" } })).toEqual({
      kind: "control",
      command: "clear_index",
    });
  });

  it("tolerates unknown extra fields for forward compatibility", () => {
    const result = parseIpcMessage({
      __vaultgate_config__: { vault: "V", futureField: 123 },
    });
    expect(result).toEqual({ kind: "config", patch: { vault: "V" } });
  });
});

describe("parseIpcMessage — rejects malformed input", () => {
  it("rejects an unknown control command", () => {
    expect(parseIpcMessage({ __vaultgate_control__: { command: "drop_everything" } })).toBeNull();
  });

  it("rejects a config patch with a wrong-typed interval (string, not number)", () => {
    // The postMessage transport preserves types — a string here is genuinely
    // malformed and must be dropped rather than silently coerced.
    expect(parseIpcMessage({ __vaultgate_config__: { injectIntervalSecs: "30" } })).toBeNull();
  });

  it("rejects a config patch with a wrong-typed vault", () => {
    expect(parseIpcMessage({ __vaultgate_config__: { vault: 42 } })).toBeNull();
  });

  it("rejects a message with neither known key", () => {
    expect(parseIpcMessage({ somethingElse: true })).toBeNull();
  });

  it("rejects non-object inputs", () => {
    expect(parseIpcMessage(null)).toBeNull();
    expect(parseIpcMessage(undefined)).toBeNull();
    expect(parseIpcMessage("string")).toBeNull();
    expect(parseIpcMessage(42)).toBeNull();
  });
});
