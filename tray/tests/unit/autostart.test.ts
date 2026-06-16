/**
 * Unit tests for `tray/src/autostart.ts`.
 *
 * Verifies the cross-platform autostart wrapper delegates to Electron's
 * `app.setLoginItemSettings` / `getLoginItemSettings` with the expected
 * options shape (`openAsHidden: true`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsState = vi.hoisted(() => ({
  loginItem: { openAtLogin: false } as Electron.LoginItemSettings,
  setCalls: [] as Electron.Settings[],
}));

vi.mock("electron", () => ({
  app: {
    setLoginItemSettings: (settings: Electron.Settings) => {
      settingsState.setCalls.push(settings);
      settingsState.loginItem = {
        ...settingsState.loginItem,
        openAtLogin: settings.openAtLogin ?? false,
      };
    },
    getLoginItemSettings: () => settingsState.loginItem,
  },
}));

beforeEach(() => {
  vi.resetModules();
  settingsState.loginItem = { openAtLogin: false } as Electron.LoginItemSettings;
  settingsState.setCalls = [];
});

afterEach(() => {
  settingsState.setCalls = [];
});

describe("setAutostart", () => {
  it("calls setLoginItemSettings with openAtLogin=true and openAsHidden=true when enabled", async () => {
    const { setAutostart } = await import("../../src/autostart.js");
    setAutostart(true);
    expect(settingsState.setCalls).toHaveLength(1);
    expect(settingsState.setCalls[0]).toMatchObject({
      openAtLogin: true,
      openAsHidden: true,
    });
  });

  it("calls setLoginItemSettings with openAtLogin=false when disabled", async () => {
    const { setAutostart } = await import("../../src/autostart.js");
    setAutostart(false);
    expect(settingsState.setCalls).toHaveLength(1);
    expect(settingsState.setCalls[0]).toMatchObject({
      openAtLogin: false,
      openAsHidden: true,
    });
  });
});

describe("isAutostartEnabled", () => {
  it("returns false when login-item is disabled", async () => {
    settingsState.loginItem = { openAtLogin: false } as Electron.LoginItemSettings;
    const { isAutostartEnabled } = await import("../../src/autostart.js");
    expect(isAutostartEnabled()).toBe(false);
  });

  it("returns true when login-item is enabled", async () => {
    settingsState.loginItem = { openAtLogin: true } as Electron.LoginItemSettings;
    const { isAutostartEnabled } = await import("../../src/autostart.js");
    expect(isAutostartEnabled()).toBe(true);
  });

  it("reflects the latest state set via setAutostart", async () => {
    const { setAutostart, isAutostartEnabled } = await import("../../src/autostart.js");
    setAutostart(true);
    expect(isAutostartEnabled()).toBe(true);
    setAutostart(false);
    expect(isAutostartEnabled()).toBe(false);
  });
});
