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

  it("renders generic port-in-use message when no port is provided", () => {
    expect(stoppedHeaderLabel("port-conflict")).toBe("○ Error — port already in use");
  });

  it("renders the specific port number when provided (regression: port-conflict shows wrong port)", () => {
    expect(stoppedHeaderLabel("port-conflict", 3001)).toBe("○ Port 3001 in use — change in Preferences");
  });

  it("renders the specific port number for any port", () => {
    expect(stoppedHeaderLabel("port-conflict", 4242)).toBe("○ Port 4242 in use — change in Preferences");
  });

  it("renders 'Obsidian not found' when the binary is missing", () => {
    expect(stoppedHeaderLabel("obsidian-missing")).toBe("○ Obsidian not found");
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

  it("preserves state:building from a prior event when merged with a raw progress event (regression: per-note IPC events carry no state field and must not clobber it)", () => {
    // The server emits two kinds of events:
    //   { type:"state", state:"building" }                          — once, at build start
    //   { type:"progress", filesProcessed:N, totalFiles:M }        — per note, no `state`
    // server-manager merges them: latestIndex = { ...latestIndex, ...ev }
    // Without the merge, `state` would be lost and the label would fall back to "warming up…".
    const buildingEvent: IndexProgressEvent = { type: "state", state: "building" };
    const progressEvent: IndexProgressEvent = { type: "progress", filesProcessed: 5, totalFiles: 10 };
    const merged = { ...buildingEvent, ...progressEvent };
    expect(smartSearchLabel(merged)).toBe("○ Building index (5/10)…");
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
