import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  installContextGuard,
  registerContextTools,
  CONVENTIONS_ENVELOPE_PREFIX,
} from "../../../src/tools/context.js";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: {
    vault: undefined,
    cliBin: "obsidian",
    port: 3001,
    host: "127.0.0.1",
    contextFileName: "VAULTGATE.md",
    injectConventions: true,
    injectIntervalSecs: 30,
  },
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);
const { config } = await import("../../../src/config.js");

function invoke(server: McpServer, name: string, args: Record<string, unknown>) {
  // @ts-ignore
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

function makeServer() {
  const server = new McpServer({ name: "t", version: "0" });
  installContextGuard(server);
  registerContextTools(server);
  return server;
}

describe("vault_context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    config.contextFileName = "VAULTGATE.md";
  });

  it("returns file content when the conventions file exists", async () => {
    mockRun.mockResolvedValue("# Vault Conventions\nUse tags liberally.");
    const result = await invoke(makeServer(), "vault_context", {});
    expect(mockRun).toHaveBeenCalledWith(["read", "path=VAULTGATE.md"]);
    expect(result.content[0].text).toBe("# Vault Conventions\nUse tags liberally.");
    expect(result.isError).toBeUndefined();
  });

  it("reads the configured filename when contextFileName is customised", async () => {
    config.contextFileName = "CLAUDE.md";
    mockRun.mockResolvedValue("# Conventions");
    await invoke(makeServer(), "vault_context", {});
    expect(mockRun).toHaveBeenCalledWith(["read", "path=CLAUDE.md"]);
  });

  it("returns not-found message when file is absent", async () => {
    mockRun.mockRejectedValue(new Error("File not found: VAULTGATE.md"));
    const result = await invoke(makeServer(), "vault_context", {});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No vault conventions file found");
    expect(result.content[0].text).toContain("vault_context_set");
  });

  it("returns isError=true on unexpected CLI error", async () => {
    mockRun.mockRejectedValue(new Error("obsidian process crashed"));
    const result = await invoke(makeServer(), "vault_context", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("obsidian process crashed");
  });
});

describe("vault_context_set", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    config.contextFileName = "VAULTGATE.md";
  });

  it("returns dry-run preview without calling CLI when dryRun=true", async () => {
    // Guard fetch fires first; mockRun returns "" for the submarine read, then the dry-run
    // result. Use mockResolvedValueOnce so the second call (dry-run has no CLI call) is separate.
    // Actually vault_context_set dry-run doesn't call CLI at all — the guard fires first.
    mockRun.mockResolvedValueOnce("# Conventions"); // submarine fetch
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: true,
    });
    // After the submarine fires, the dry-run result's first block is merged.
    const firstText = result.content[0].text;
    expect(firstText).toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(firstText).toContain("[DRY RUN]");
    expect(firstText).toContain("VAULTGATE.md");
  });

  it("calls CLI with correct args and returns success when dryRun=false", async () => {
    mockRun.mockResolvedValueOnce("# Conventions"); // submarine fetch
    mockRun.mockResolvedValueOnce("");              // vault_context_set write
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "create",
      "name=VAULTGATE.md",
      "content=# My Conventions",
      "overwrite",
    ]);
    const firstText = result.content[0].text;
    expect(firstText).toContain("Vault conventions file updated");
    expect(result.isError).toBeUndefined();
  });

  it("writes to the configured filename when contextFileName is customised", async () => {
    config.contextFileName = "CLAUDE.md";
    mockRun.mockResolvedValueOnce("# Conventions"); // submarine fetch
    mockRun.mockResolvedValueOnce("");              // vault_context_set write
    await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "create",
      "name=CLAUDE.md",
      "content=# My Conventions",
      "overwrite",
    ]);
  });

  it("returns isError=true when CLI fails on dryRun=false", async () => {
    // Handler runs first (write errors → isError:true), then guard sees isError and skips submarine.
    mockRun.mockRejectedValueOnce(new Error("vault write failed"));
    const result = await invoke(makeServer(), "vault_context_set", {
      content: "# My Conventions",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault write failed");
  });
});

describe("installContextGuard — submarine behaviour", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    config.contextFileName = "VAULTGATE.md";
    config.injectConventions = true;
    config.injectIntervalSecs = 30;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges conventions into the first text block on the first tool call", async () => {
    const server = makeServer();
    mockRun.mockResolvedValueOnce("# My Conventions"); // submarine fetch
    const result = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    const firstText = result.content[0].text;
    expect(firstText).toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(firstText).toContain("# My Conventions");
    expect(firstText).toContain("---");
    expect(firstText).toContain("[DRY RUN]");
  });

  it("does not re-inject within the TTL window", async () => {
    vi.useFakeTimers();
    const server = makeServer();
    // First call — injects
    mockRun.mockResolvedValueOnce("# Conventions");
    await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    // Second call immediately after — within 30s TTL, no re-inject
    vi.resetAllMocks();
    const result2 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result2.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("re-injects after the TTL expires", async () => {
    vi.useFakeTimers();
    const server = makeServer();
    // First call — injects
    mockRun.mockResolvedValueOnce("# Conventions");
    await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    // Advance time past the 30s TTL
    vi.advanceTimersByTime(31_000);
    // Next call — should re-inject
    mockRun.mockResolvedValueOnce("# Conventions updated");
    const result = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result.content[0].text).toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(result.content[0].text).toContain("# Conventions updated");
  });

  it("skips injection when injectConventions is false", async () => {
    config.injectConventions = false;
    const server = makeServer();
    const result = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("respects injectIntervalSecs from config", async () => {
    vi.useFakeTimers();
    config.injectIntervalSecs = 5;
    const server = makeServer();
    // First call — injects
    mockRun.mockResolvedValueOnce("# Conventions");
    await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    // Advance only 3s — still within 5s TTL
    vi.advanceTimersByTime(3_000);
    vi.resetAllMocks();
    const r2 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(r2.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    // Advance past the 5s TTL
    vi.advanceTimersByTime(3_000);
    mockRun.mockResolvedValueOnce("# Conventions");
    const r3 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(r3.content[0].text).toContain(CONVENTIONS_ENVELOPE_PREFIX);
  });

  it("does not decorate vault_context's own result", async () => {
    mockRun.mockResolvedValue("# Conventions");
    const server = makeServer();
    const result = await invoke(server, "vault_context", {});
    expect(result.content[0].text).toBe("# Conventions");
    expect(result.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("vault_context call resets the TTL (no re-inject on next tool call)", async () => {
    vi.useFakeTimers();
    const server = makeServer();
    // Advance past TTL so submarine would fire
    vi.advanceTimersByTime(31_000);
    // Call vault_context explicitly — resets timestamp
    mockRun.mockResolvedValueOnce("# Conventions");
    await invoke(server, "vault_context", {});
    // Immediately call another tool — should NOT inject (TTL just reset)
    vi.resetAllMocks();
    const result = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not decorate isError results", async () => {
    mockRun.mockRejectedValueOnce(new Error("crash"));
    const server = makeServer();
    const result = await invoke(server, "vault_context_set", { content: "x", dryRun: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
  });

  it("when conventions file absent: injects nothing and stops retrying within TTL", async () => {
    vi.useFakeTimers();
    const server = makeServer();
    mockRun.mockRejectedValueOnce(new Error("File not found: VAULTGATE.md"));
    const result1 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result1.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    // Within TTL — no retry
    vi.resetAllMocks();
    const result2 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result2.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("when transient error: injects nothing but retries on next call", async () => {
    const server = makeServer();
    mockRun.mockRejectedValueOnce(new Error("connection refused"));
    const result1 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result1.content[0].text).not.toContain(CONVENTIONS_ENVELOPE_PREFIX);
    // Next call retries immediately (lastInjectedAt not updated on transient error)
    mockRun.mockResolvedValueOnce("# Conventions");
    const result2 = await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(result2.content[0].text).toContain(CONVENTIONS_ENVELOPE_PREFIX);
  });

  it("envelope prefix does not match JWD high-confidence injection patterns", () => {
    const highConfidencePatterns = [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
      /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|guidelines)/i,
      /override\s+(your|the|system)\s+(instructions|prompt|rules|guidelines)/i,
      /new\s+system\s+prompt\s*:/i,
      /\[?\s*(SYSTEM|AI NOTE|JOULE-INTERNAL|AGENT CONTEXT)\s*\]?\s*:/i,
      /IMPORTANT\s+FOR\s+AI\s+ASSISTANTS?\s*:/i,
      /---\s*SYSTEM/i,
      /###\s*INSTRUCTIONS/i,
      /<\|system\|>/i,
      /<\|im_start\|>system/i,
      /\[INST\]/i,
      /run_terminal_command\s*\(/i,
      /execute.*terminal.*command.*\(/i,
      /write_file\s*\(/i,
      /edit_file\s*\(/i,
      /read_file\s*\(/i,
    ];
    for (const pattern of highConfidencePatterns) {
      expect(CONVENTIONS_ENVELOPE_PREFIX).not.toMatch(pattern);
    }
  });

  it("uses config.contextFileName for the fetch", async () => {
    config.contextFileName = "CLAUDE.md";
    const server = makeServer();
    mockRun.mockResolvedValueOnce("# Conventions");
    await invoke(server, "vault_context_set", { content: "x", dryRun: true });
    expect(mockRun).toHaveBeenCalledWith(["read", "path=CLAUDE.md"]);
  });
});
