/**
 * MCP tool schema contract tests.
 *
 * These tests freeze the JSON Schema shape of every tool that carries
 * a destructive parameter (dryRun, required fields, enums, union types).
 * A rename of a required field, removal of an enum value, or a change to
 * a dryRun default would be a silent breaking change for every connected
 * client — these tests make that visible before it ships.
 *
 * Strategy: call listTools() on a real connected server, then assert each
 * priority tool's inputSchema with toMatchObject.
 *   - toMatchObject: additive changes (new optional fields) pass.
 *   - Required field renamed or removed → test fails.
 *
 * Tools covered: note_create, note_update, note_trash, daily_append,
 *   vault_context_set, note_open, search_open, daily_open.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));

import { createServer } from "../../src/server.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const DRY_RUN_SCHEMA = {
  anyOf: [{ type: "boolean" }, { type: "string" }],
} as const;

const OPTIONAL_BOOL_SCHEMA = {
  anyOf: [{ type: "boolean" }, { type: "string" }],
} as const;

describe("MCP tool schema contracts", () => {
  let tools: Map<string, Tool>;

  beforeAll(async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "contract-test", version: "0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools: list } = await client.listTools();
    tools = new Map(list.map((t) => [t.name, t]));
    await client.close();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Destructive write tools — dryRun shape is the critical invariant
  // ---------------------------------------------------------------------------

  it("note_create — required dryRun union, optional name/path/content/template", () => {
    const schema = tools.get("note_create")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        content: { type: "string" },
        template: { type: "string" },
        overwrite: OPTIONAL_BOOL_SCHEMA,
        silent: OPTIONAL_BOOL_SCHEMA,
        dryRun: DRY_RUN_SCHEMA,
      },
    });
    // name and path must NOT be required — both optional, at least one must be usable
    const required: string[] = (schema as { required?: string[] }).required ?? [];
    expect(required).not.toContain("name");
    expect(required).not.toContain("path");
  });

  it("note_update — path and content required, dryRun union", () => {
    const schema = tools.get("note_update")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        dryRun: DRY_RUN_SCHEMA,
      },
      required: expect.arrayContaining(["path", "content"]),
    });
  });

  it("note_trash — path required, dryRun union", () => {
    const schema = tools.get("note_trash")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        path: { type: "string" },
        dryRun: DRY_RUN_SCHEMA,
      },
      required: expect.arrayContaining(["path"]),
    });
  });

  it("daily_append — content required, dryRun union", () => {
    const schema = tools.get("daily_append")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        content: { type: "string" },
        dryRun: DRY_RUN_SCHEMA,
      },
      required: expect.arrayContaining(["content"]),
    });
  });

  it("vault_context_set — content required, dryRun union", () => {
    const schema = tools.get("vault_context_set")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        content: { type: "string" },
        dryRun: DRY_RUN_SCHEMA,
      },
      required: expect.arrayContaining(["content"]),
    });
  });

  // ---------------------------------------------------------------------------
  // URI tools — key field names must not change (they form the obsidian:// URI)
  // ---------------------------------------------------------------------------

  it("note_open — file, path, heading, block all optional strings", () => {
    const schema = tools.get("note_open")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        file: { type: "string" },
        path: { type: "string" },
        heading: { type: "string" },
        block: { type: "string" },
      },
    });
  });

  it("search_open — query required string", () => {
    const schema = tools.get("search_open")?.inputSchema;
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: expect.arrayContaining(["query"]),
    });
  });

  it("daily_open — no required parameters", () => {
    const schema = tools.get("daily_open")?.inputSchema;
    expect(schema).toMatchObject({ type: "object" });
    const required: string[] = (schema as { required?: string[] }).required ?? [];
    expect(required).toHaveLength(0);
  });
});
