import { describe, it, expect } from "vitest";
import { createServer, TOOL_COUNT } from "../../src/server.js";

describe("server tool registration", () => {
  it("registers all expected tools", async () => {
    const server = createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );

    expect(result).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBe(TOOL_COUNT);
  });

  it("registers all tool groups by name", async () => {
    const server = createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );

    const names: string[] = result.tools.map((t: { name: string }) => t.name);

    // files group
    expect(names).toContain("files_list");
    expect(names).toContain("files_read");
    expect(names).toContain("note_create");
    expect(names).toContain("note_append");

    // search group
    expect(names).toContain("search");

    // daily group
    expect(names).toContain("daily_read");
    expect(names).toContain("daily_append");

    // tasks group
    expect(names).toContain("tasks_all");
    expect(names).toContain("tasks_pending");
    expect(names).toContain("tasks_daily");

    // templates group
    expect(names).toContain("templates_list");
    expect(names).toContain("templates_apply");

    // properties group
    expect(names).toContain("property_read");
    expect(names).toContain("property_set");

    // tags group
    expect(names).toContain("tags");
    expect(names).toContain("backlinks");
    expect(names).toContain("unresolved");

    // plugins group
    expect(names).toContain("plugins_list");
    expect(names).toContain("plugin_reload");

    // dev group
    expect(names).toContain("eval");
    expect(names).toContain("dev_errors");
    expect(names).toContain("dev_console");
    expect(names).toContain("dev_css");
    expect(names).toContain("dev_dom");
    expect(names).toContain("dev_screenshot");
    expect(names).toContain("dev_mobile");
  });

  it("TOOL_COUNT constant matches actual registered tool count", async () => {
    const server = createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );
    // If this fails, update TOOL_COUNT in server.ts
    expect(result.tools.length).toBe(TOOL_COUNT);
  });

  it("all tools have a name and description", async () => {
    const server = createServer();
    // @ts-ignore
    const result = await server.server._requestHandlers.get("tools/list")?.(
      { method: "tools/list", params: {} },
      {}
    );

    for (const tool of result.tools) {
      expect(tool.name, "tool is missing a name").toBeTruthy();
      expect(
        tool.description,
        `tool "${tool.name}" is missing a description`
      ).toBeTruthy();
    }
  });
});
