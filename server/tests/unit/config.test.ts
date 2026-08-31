import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

describe("loadConfig — injection settings", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VAULTGATE_INJECT_INTERVAL;
    delete process.env.VAULTGATE_INJECT_CONVENTIONS;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("defaults injectIntervalSecs to 30 and injectConventions to true when unset", async () => {
    const { loadConfig } = await import("../../src/config.js?inj=1");
    const cfg = loadConfig();
    expect(cfg.injectIntervalSecs).toBe(30);
    expect(cfg.injectConventions).toBe(true);
  });

  it("reads a valid VAULTGATE_INJECT_INTERVAL", async () => {
    process.env.VAULTGATE_INJECT_INTERVAL = "120";
    const { loadConfig } = await import("../../src/config.js?inj=2");
    expect(loadConfig().injectIntervalSecs).toBe(120);
  });

  it("accepts the lower boundary of 1", async () => {
    process.env.VAULTGATE_INJECT_INTERVAL = "1";
    const { loadConfig } = await import("../../src/config.js?inj=3");
    expect(loadConfig().injectIntervalSecs).toBe(1);
  });

  it("accepts the upper boundary of 3600", async () => {
    process.env.VAULTGATE_INJECT_INTERVAL = "3600";
    const { loadConfig } = await import("../../src/config.js?inj=4");
    expect(loadConfig().injectIntervalSecs).toBe(3600);
  });

  it("warns and falls back to the default when the interval is below 1", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VAULTGATE_INJECT_INTERVAL = "0";
    const { loadConfig } = await import("../../src/config.js?inj=5");
    expect(loadConfig().injectIntervalSecs).toBe(30);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("VAULTGATE_INJECT_INTERVAL"));
  });

  it("warns and falls back to the default when the interval exceeds 3600", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VAULTGATE_INJECT_INTERVAL = "3601";
    const { loadConfig } = await import("../../src/config.js?inj=6");
    expect(loadConfig().injectIntervalSecs).toBe(30);
    expect(spy).toHaveBeenCalled();
  });

  it("warns and falls back to the default when the interval is non-numeric", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.VAULTGATE_INJECT_INTERVAL = "abc";
    const { loadConfig } = await import("../../src/config.js?inj=7");
    expect(loadConfig().injectIntervalSecs).toBe(30);
    expect(spy).toHaveBeenCalled();
  });

  it("disables injection when VAULTGATE_INJECT_CONVENTIONS is exactly 'false'", async () => {
    process.env.VAULTGATE_INJECT_CONVENTIONS = "false";
    const { loadConfig } = await import("../../src/config.js?inj=8");
    expect(loadConfig().injectConventions).toBe(false);
  });

  it("only the literal 'false' disables injection — 'FALSE' stays enabled (documented behavior)", async () => {
    process.env.VAULTGATE_INJECT_CONVENTIONS = "FALSE";
    const { loadConfig } = await import("../../src/config.js?inj=9");
    expect(loadConfig().injectConventions).toBe(true);
  });
});

describe("setInjectionConfig", () => {
  it("applies valid enabled + interval values", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=1");
    setInjectionConfig(true, 90);
    expect(config.injectConventions).toBe(true);
    expect(config.injectIntervalSecs).toBe(90);
  });

  it("preserves a disabled flag (regression: enabled=false must be written through)", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=2");
    setInjectionConfig(false, 30);
    expect(config.injectConventions).toBe(false);
  });

  it("falls back to the default when the interval is 0 (regression: interval=0 disabled the TTL guard, re-injecting conventions on every tool call)", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=3");
    setInjectionConfig(true, 0);
    expect(config.injectIntervalSecs).toBe(30);
  });

  it("falls back to the default when the interval is negative", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=4");
    setInjectionConfig(true, -5);
    expect(config.injectIntervalSecs).toBe(30);
  });

  it("falls back to the default when the interval exceeds 3600", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=5");
    setInjectionConfig(true, 3601);
    expect(config.injectIntervalSecs).toBe(30);
  });

  it("falls back to the default when the interval is NaN", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=6");
    setInjectionConfig(true, Number.NaN);
    expect(config.injectIntervalSecs).toBe(30);
  });

  it("coerces a string interval arriving over IPC (regression: field typed number but the IPC boundary may deliver a string)", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=7");
    // Simulate the untyped IPC value the type system does not see.
    setInjectionConfig(true, "60" as unknown as number);
    expect(config.injectIntervalSecs).toBe(60);
  });

  it("falls back to the default for a non-integer interval", async () => {
    const { config, setInjectionConfig } = await import("../../src/config.js?set=8");
    setInjectionConfig(true, 30.5);
    expect(config.injectIntervalSecs).toBe(30);
  });
});
