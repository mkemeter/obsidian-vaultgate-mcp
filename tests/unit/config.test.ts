import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.OBSIDIAN_VAULT;
    delete process.env.OBSIDIAN_CLI_PATH;
    delete process.env.OBSIDIAN_MCP_PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default values when no env vars are set", async () => {
    const { loadConfig } = await import("../../src/config.js?fresh=1");
    const cfg = loadConfig();
    expect(cfg.vault).toBeUndefined();
    expect(cfg.cliBin).toBe("obsidian");
    expect(cfg.port).toBe(3001);
    expect(cfg.host).toBe("127.0.0.1");
  });

  it("reads OBSIDIAN_VAULT from environment", async () => {
    process.env.OBSIDIAN_VAULT = "MyVault";
    const { loadConfig } = await import("../../src/config.js?fresh=2");
    const cfg = loadConfig();
    expect(cfg.vault).toBe("MyVault");
  });

  it("returns undefined vault when OBSIDIAN_VAULT is empty string", async () => {
    process.env.OBSIDIAN_VAULT = "";
    const { loadConfig } = await import("../../src/config.js?fresh=3");
    const cfg = loadConfig();
    expect(cfg.vault).toBeUndefined();
  });

  it("reads OBSIDIAN_CLI_PATH from environment", async () => {
    process.env.OBSIDIAN_CLI_PATH = "/Applications/Obsidian.app/Contents/MacOS/obsidian";
    const { loadConfig } = await import("../../src/config.js?fresh=4");
    const cfg = loadConfig();
    expect(cfg.cliBin).toBe("/Applications/Obsidian.app/Contents/MacOS/obsidian");
  });

  it("reads OBSIDIAN_MCP_PORT from environment", async () => {
    process.env.OBSIDIAN_MCP_PORT = "4000";
    const { loadConfig } = await import("../../src/config.js?fresh=5");
    const cfg = loadConfig();
    expect(cfg.port).toBe(4000);
  });

  it("throws a descriptive error when OBSIDIAN_MCP_PORT is not a number", async () => {
    process.env.OBSIDIAN_MCP_PORT = "not-a-port";
    // The module calls loadConfig() at load time, so the error surfaces on import.
    await expect(import("../../src/config.js?fresh=6")).rejects.toThrow(
      'Invalid OBSIDIAN_MCP_PORT value "not-a-port"'
    );
  });

  it("host is always 127.0.0.1 regardless of environment", async () => {
    const { loadConfig } = await import("../../src/config.js?fresh=7");
    const cfg = loadConfig();
    expect(cfg.host).toBe("127.0.0.1");
  });
});
