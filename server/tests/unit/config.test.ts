import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("setVault", () => {
  it("mutates config.vault in place so the running server picks up vault changes without restart", async () => {
    const { config, setVault } = await import("../../src/config.js");
    const original = config.vault;
    setVault("NewVault");
    expect(config.vault).toBe("NewVault");
    // Restore so this test doesn't bleed into others sharing the same module instance.
    setVault(original);
  });

  it("accepts undefined to clear the vault targeting", async () => {
    const { config, setVault } = await import("../../src/config.js");
    setVault(undefined);
    expect(config.vault).toBeUndefined();
  });
});

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.OBSIDIAN_VAULT;
    delete process.env.OBSIDIAN_CLI_PATH;
    delete process.env.OBSIDIAN_MCP_PORT;
    delete process.env.OBSIDIAN_CONTEXT_FILE;
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
    expect(cfg.contextFileName).toBe("VAULTGATE.md");
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

  it("trims whitespace from OBSIDIAN_VAULT", async () => {
    process.env.OBSIDIAN_VAULT = "  My Vault  ";
    const { loadConfig } = await import("../../src/config.js?fresh=3b");
    const cfg = loadConfig();
    expect(cfg.vault).toBe("My Vault");
  });

  it("returns undefined vault when OBSIDIAN_VAULT is whitespace only", async () => {
    process.env.OBSIDIAN_VAULT = "   ";
    const { loadConfig } = await import("../../src/config.js?fresh=3c");
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

  it("throws when OBSIDIAN_MCP_PORT is 0", async () => {
    process.env.OBSIDIAN_MCP_PORT = "0";
    await expect(import("../../src/config.js?fresh=6b")).rejects.toThrow(
      'Invalid OBSIDIAN_MCP_PORT value "0"'
    );
  });

  it("throws when OBSIDIAN_MCP_PORT is negative", async () => {
    process.env.OBSIDIAN_MCP_PORT = "-1";
    await expect(import("../../src/config.js?fresh=6c")).rejects.toThrow(
      'Invalid OBSIDIAN_MCP_PORT value "-1"'
    );
  });

  it("throws when OBSIDIAN_MCP_PORT exceeds 65535", async () => {
    process.env.OBSIDIAN_MCP_PORT = "65536";
    await expect(import("../../src/config.js?fresh=6d")).rejects.toThrow(
      'Invalid OBSIDIAN_MCP_PORT value "65536"'
    );
  });

  it("accepts OBSIDIAN_MCP_PORT at boundary value 65535", async () => {
    process.env.OBSIDIAN_MCP_PORT = "65535";
    const { loadConfig } = await import("../../src/config.js?fresh=6e");
    const cfg = loadConfig();
    expect(cfg.port).toBe(65535);
  });

  it("host is always 127.0.0.1 regardless of environment", async () => {
    const { loadConfig } = await import("../../src/config.js?fresh=7");
    const cfg = loadConfig();
    expect(cfg.host).toBe("127.0.0.1");
  });

  it("reads OBSIDIAN_CONTEXT_FILE from environment", async () => {
    process.env.OBSIDIAN_CONTEXT_FILE = "CLAUDE.md";
    const { loadConfig } = await import("../../src/config.js?fresh=8");
    const cfg = loadConfig();
    expect(cfg.contextFileName).toBe("CLAUDE.md");
  });

  it("falls back to VAULTGATE.md when OBSIDIAN_CONTEXT_FILE is whitespace only", async () => {
    process.env.OBSIDIAN_CONTEXT_FILE = "   ";
    const { loadConfig } = await import("../../src/config.js?fresh=8a");
    const cfg = loadConfig();
    expect(cfg.contextFileName).toBe("VAULTGATE.md");
  });

  it("throws when OBSIDIAN_CONTEXT_FILE contains a path separator", async () => {
    process.env.OBSIDIAN_CONTEXT_FILE = "sub/CLAUDE.md";
    await expect(import("../../src/config.js?fresh=8b")).rejects.toThrow(
      'Invalid OBSIDIAN_CONTEXT_FILE value "sub/CLAUDE.md"'
    );
  });

  it("throws when OBSIDIAN_CONTEXT_FILE is not a Markdown file", async () => {
    process.env.OBSIDIAN_CONTEXT_FILE = "notes.txt";
    await expect(import("../../src/config.js?fresh=8c")).rejects.toThrow(
      'Invalid OBSIDIAN_CONTEXT_FILE value "notes.txt"'
    );
  });
});

describe("normalizeContextFileName", () => {
  it("returns the default when the value is undefined or empty", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(normalizeContextFileName(undefined)).toBe("VAULTGATE.md");
    expect(normalizeContextFileName("")).toBe("VAULTGATE.md");
  });

  it("accepts a bare .md filename (case-insensitive extension)", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(normalizeContextFileName("CLAUDE.md")).toBe("CLAUDE.md");
    expect(normalizeContextFileName("Notes.MD")).toBe("Notes.MD");
  });

  it("rejects forward-slash path separators", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(() => normalizeContextFileName("a/b.md")).toThrow("must be a bare filename");
  });

  it("rejects backslash path separators", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(() => normalizeContextFileName("a\\b.md")).toThrow("must be a bare filename");
  });

  it("rejects parent-directory segments", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(() => normalizeContextFileName("..md")).toThrow("must be a bare filename");
  });

  it("rejects filenames that do not end in .md", async () => {
    const { normalizeContextFileName } = await import("../../src/config.js");
    expect(() => normalizeContextFileName("notes.txt")).toThrow('must be a Markdown file ending in ".md"');
  });
});
