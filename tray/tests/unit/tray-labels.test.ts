/**
 * Unit tests for `tray/src/tray-labels.ts`.
 *
 * These cover every label state the user might see in the tray menu:
 * connection URL, vault header, server-state header, smart-search progress,
 * and the first-launch notification body. The functions are pure — no
 * Electron required — so coverage of user-visible strings is full.
 */

import { describe, expect, it } from "vitest";
import {
  connectionUrl,
  runningHeaderLabel,
  smartSearchLabel,
  smartSearchReadyNotificationBody,
  stoppedHeaderLabel,
} from "../../src/tray-labels.js";
import type { IndexProgressEvent } from "../../src/server-manager.js";

describe("connectionUrl", () => {
  it("formats the standard URL on the configured port", () => {
    expect(connectionUrl(3001)).toBe("http://127.0.0.1:3001/mcp");
  });

  it("respects a custom port", () => {
    expect(connectionUrl(4242)).toBe("http://127.0.0.1:4242/mcp");
  });
});

describe("runningHeaderLabel", () => {
  it("includes the configured vault name when one is set", () => {
    expect(runningHeaderLabel("MyVault")).toBe("● Running — MyVault");
  });

  it("falls back to 'Active vault' when no vault is configured (default = follow Obsidian)", () => {
    expect(runningHeaderLabel("")).toBe("● Running — Active vault");
  });
});

describe("stoppedHeaderLabel", () => {
  it("renders 'Stopped' for the idle state", () => {
    expect(stoppedHeaderLabel("idle")).toBe("○ Stopped");
  });

  it("renders 'Stopped' for the stopped state", () => {
    expect(stoppedHeaderLabel("stopped")).toBe("○ Stopped");
  });

  it("renders 'Starting…' while pre-flight is in progress", () => {
    expect(stoppedHeaderLabel("starting")).toBe("● Starting…");
  });

  it("renders 'Error — server crashed' for the error state", () => {
    expect(stoppedHeaderLabel("error")).toBe("○ Error — server crashed");
  });

  it("renders 'Error — port in use' for the port-conflict state", () => {
    expect(stoppedHeaderLabel("port-conflict")).toBe("○ Error — port in use");
  });

  it("renders 'Obsidian not found' when the binary is missing", () => {
    expect(stoppedHeaderLabel("obsidian-missing")).toBe("○ Obsidian not found");
  });

  it("renders 'Obsidian CLI not registered' when the smoke test fails", () => {
    expect(stoppedHeaderLabel("cli-not-registered")).toBe("○ Obsidian CLI not registered");
  });
});

describe("smartSearchLabel", () => {
  it("renders the ready label with a singular 'note' for one note", () => {
    const ev: IndexProgressEvent = { type: "state", state: "ready", filesProcessed: 1 };
    expect(smartSearchLabel(ev)).toBe("✓ Smart search ready — 1 note");
  });

  it("renders the ready label with plural 'notes' for many notes", () => {
    const ev: IndexProgressEvent = { type: "state", state: "ready", filesProcessed: 523 };
    expect(smartSearchLabel(ev)).toBe("✓ Smart search ready — 523 notes");
  });

  it("renders zero notes correctly", () => {
    const ev: IndexProgressEvent = { type: "state", state: "ready", filesProcessed: 0 };
    expect(smartSearchLabel(ev)).toBe("✓ Smart search ready — 0 notes");
  });

  it("falls back to zero when filesProcessed is missing on a ready event", () => {
    const ev: IndexProgressEvent = { type: "state", state: "ready" };
    expect(smartSearchLabel(ev)).toBe("✓ Smart search ready — 0 notes");
  });

  it("renders progress with counts when both are known during build", () => {
    const ev: IndexProgressEvent = {
      type: "progress",
      state: "building",
      filesProcessed: 142,
      totalFiles: 500,
    };
    expect(smartSearchLabel(ev)).toBe("○ Building index (142/500)…");
  });

  it("falls back to a generic build label when totalFiles is unknown", () => {
    const ev: IndexProgressEvent = { type: "state", state: "building" };
    expect(smartSearchLabel(ev)).toBe("○ Building index…");
  });

  it("falls back to a generic build label when totalFiles is zero (avoids 'N/0')", () => {
    const ev: IndexProgressEvent = {
      type: "progress",
      state: "building",
      filesProcessed: 0,
      totalFiles: 0,
    };
    expect(smartSearchLabel(ev)).toBe("○ Building index…");
  });

  it("renders the index error label for error events", () => {
    const ev: IndexProgressEvent = { type: "error", state: "error", error: "boom" };
    expect(smartSearchLabel(ev)).toBe("✗ Smart search index error");
  });

  it("falls back to the warming-up label for the idle state", () => {
    const ev: IndexProgressEvent = { type: "state", state: "idle" };
    expect(smartSearchLabel(ev)).toBe("○ Smart search warming up…");
  });

  it("falls back to the warming-up label when state is undefined", () => {
    const ev: IndexProgressEvent = { type: "state" };
    expect(smartSearchLabel(ev)).toBe("○ Smart search warming up…");
  });
});

describe("smartSearchReadyNotificationBody", () => {
  it("uses the singular noun for one note", () => {
    expect(smartSearchReadyNotificationBody(1)).toBe("Smart search is ready (1 note indexed).");
  });

  it("uses the plural noun for many notes", () => {
    expect(smartSearchReadyNotificationBody(42)).toBe("Smart search is ready (42 notes indexed).");
  });

  it("uses the plural noun for zero notes", () => {
    expect(smartSearchReadyNotificationBody(0)).toBe("Smart search is ready (0 notes indexed).");
  });
});
