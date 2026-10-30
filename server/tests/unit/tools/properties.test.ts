import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPropertyTools } from "../../../src/tools/properties.js";

vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));
vi.mock("../../../src/config.js", () => ({
  config: { vault: undefined, cliBin: "obsidian", port: 3001, host: "127.0.0.1" },
}));
vi.mock("../../../src/scope.js", () => ({
  isPathBlocked: vi.fn().mockReturnValue(false),
  isScopingEnabled: vi.fn().mockReturnValue(false),
  filterByScope: vi.fn().mockImplementation((paths: string[]) => paths),
  SCOPE_BLOCKED_MESSAGE: "scope blocked",
}));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

const { filterByScope } = await import("../../../src/scope.js");
const mockFilterByScope = vi.mocked(filterByScope);

function invoke(server: McpServer, name: string, args: Record<string, unknown>) {
  // @ts-ignore
  return server.server._requestHandlers.get("tools/call")?.(
    { method: "tools/call", params: { name, arguments: args } },
    {}
  );
}

function makeServer() {
  const server = new McpServer({ name: "t", version: "0" });
  registerPropertyTools(server);
  return server;
}

describe("property_read", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls obsidian property:read with name for active file", async () => {
    mockRun.mockResolvedValue("draft");
    const result = await invoke(makeServer(), "property_read", { name: "status" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status"]);
    expect(result.content[0].text).toContain("draft");
  });

  it("includes file arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_read", { name: "tags", file: "My Note" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=tags", "file=My Note"]);
  });

  it("includes path arg when provided", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_read", { name: "status", path: "HR/note.md" });
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status", "path=HR/note.md"]);
  });

  it("returns isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("file not found"));
    const result = await invoke(makeServer(), "property_read", { name: "status" });
    expect(result.isError).toBe(true);
  });
});

describe("property_set (destructive)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns dry run preview by default", async () => {
    const result = await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
    });
    expect(mockRun).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(result.content[0].text).toContain("property:set");
  });

  it("executes with name, value, and file args when dryRun=false", async () => {
    mockRun.mockResolvedValue("");
    await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
      file: "My Note",
      dryRun: false,
    });
    expect(mockRun).toHaveBeenCalledWith([
      "property:set",
      "name=status",
      "value=done",
      "file=My Note",
    ]);
  });

  it("returns isError on CLI failure when dryRun=false", async () => {
    mockRun.mockRejectedValue(new Error("property error"));
    const result = await invoke(makeServer(), "property_set", {
      name: "status",
      value: "done",
      dryRun: false,
    });
    expect(result.isError).toBe(true);
  });
});

describe("property_search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFilterByScope.mockImplementation((paths: string[]) => paths);
  });

  it("returns paths where value matches exactly", async () => {
    mockRun
      .mockResolvedValueOnce("Projects/A.md\nProjects/B.md") // files list
      .mockResolvedValueOnce("active") // property:read A
      .mockResolvedValueOnce("inactive"); // property:read B
    const result = await invoke(makeServer(), "property_search", { key: "status", value: "active" });
    expect(result.content[0].text).toBe("Projects/A.md");
    expect(result.isError).toBeUndefined();
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status", "path=Projects/A.md"]);
    expect(mockRun).toHaveBeenCalledWith(["property:read", "name=status", "path=Projects/B.md"]);
  });

  it("returns empty string when no matches", async () => {
    mockRun
      .mockResolvedValueOnce("A.md")
      .mockResolvedValueOnce("inactive");
    const result = await invoke(makeServer(), "property_search", { key: "status", value: "active" });
    expect(result.content[0].text).toBe("");
    expect(result.isError).toBeUndefined();
  });

  it("returns files with the key (existence only) when no filter criteria", async () => {
    mockRun
      .mockResolvedValueOnce("A.md\nB.md")
      .mockResolvedValueOnce("some-value") // A has property → included
      .mockResolvedValueOnce(""); // B has empty value → excluded
    const result = await invoke(makeServer(), "property_search", { key: "status" });
    expect(result.content[0].text).toBe("A.md");
  });

  it("missing: true includes file with empty property value", async () => {
    mockRun
      .mockResolvedValueOnce("A.md")
      .mockResolvedValueOnce(""); // empty → missing
    const result = await invoke(makeServer(), "property_search", { key: "owner", missing: true });
    expect(result.content[0].text).toBe("A.md");
  });

  it("missing: true includes file where property:read throws", async () => {
    mockRun
      .mockResolvedValueOnce("A.md")
      .mockRejectedValueOnce(new Error("property not found"));
    const result = await invoke(makeServer(), "property_search", { key: "owner", missing: true });
    expect(result.content[0].text).toBe("A.md");
  });

  it("missing: true excludes file that has a non-empty property value", async () => {
    mockRun
      .mockResolvedValueOnce("A.md")
      .mockResolvedValueOnce("Alice");
    const result = await invoke(makeServer(), "property_search", { key: "assignee", missing: true });
    expect(result.content[0].text).toBe("");
  });

  it("before filter includes earlier dates and excludes later dates", async () => {
    mockRun
      .mockResolvedValueOnce("A.md\nB.md")
      .mockResolvedValueOnce("2026-10-01") // before 2026-10-30 → included
      .mockResolvedValueOnce("2026-11-01"); // not before → excluded
    const result = await invoke(makeServer(), "property_search", { key: "due", before: "2026-10-30" });
    expect(result.content[0].text).toBe("A.md");
  });

  it("after filter includes later dates and excludes earlier dates", async () => {
    mockRun
      .mockResolvedValueOnce("A.md\nB.md")
      .mockResolvedValueOnce("2026-11-01") // after 2026-10-30 → included
      .mockResolvedValueOnce("2026-09-01"); // not after → excluded
    const result = await invoke(makeServer(), "property_search", { key: "start", after: "2026-10-30" });
    expect(result.content[0].text).toBe("A.md");
  });

  it("excludes unparseable values from date filters", async () => {
    mockRun
      .mockResolvedValueOnce("A.md")
      .mockResolvedValueOnce("not-a-date");
    const result = await invoke(makeServer(), "property_search", { key: "due", before: "2026-10-30" });
    expect(result.content[0].text).toBe("");
  });

  it("path prefix restricts which files are read", async () => {
    mockRun
      .mockResolvedValueOnce("Projects/A.md\nDaily/B.md") // files list
      .mockResolvedValueOnce("active"); // only Projects/A.md is checked
    const result = await invoke(makeServer(), "property_search", {
      key: "status",
      value: "active",
      path: "Projects",
    });
    expect(result.content[0].text).toBe("Projects/A.md");
    expect(mockRun).toHaveBeenCalledTimes(2); // list + 1 property read
  });

  it("path prefix with trailing slash also works", async () => {
    mockRun
      .mockResolvedValueOnce("Projects/A.md\nDaily/B.md")
      .mockResolvedValueOnce("active");
    const result = await invoke(makeServer(), "property_search", {
      key: "status",
      value: "active",
      path: "Projects/",
    });
    expect(result.content[0].text).toBe("Projects/A.md");
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("returns isError when files list fails", async () => {
    mockRun.mockRejectedValueOnce(new Error("vault not connected"));
    const result = await invoke(makeServer(), "property_search", { key: "status" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("vault not connected");
  });

  it("applies scope filtering — only scoped files are checked", async () => {
    mockFilterByScope.mockReturnValue(["Projects/A.md"]); // B.md filtered out by scope
    mockRun
      .mockResolvedValueOnce("Projects/A.md\nPrivate/B.md") // files list
      .mockResolvedValueOnce("active"); // only A.md read
    const result = await invoke(makeServer(), "property_search", { key: "status", value: "active" });
    expect(result.content[0].text).toBe("Projects/A.md");
    expect(mockRun).toHaveBeenCalledTimes(2); // list + 1 (not 2)
  });
});
