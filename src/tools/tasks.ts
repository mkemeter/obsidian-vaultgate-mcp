import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { buildFileArgs } from "./_helpers.js";

/**
 * Registers task management tools on the MCP server.
 *
 * All task tools are read-only — they query tasks but do not modify them.
 * Use `note_append` or `daily_append` to add new tasks.
 *
 * Tools registered:
 * - `tasks_all`     — all tasks in the vault
 * - `tasks_pending` — only uncompleted tasks
 * - `tasks_daily`   — pending tasks in today's daily note
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerTaskTools(server: McpServer): void {
  const fileSchema = {
    file: z
      .string()
      .optional()
      .describe(
        "Scope results to a specific note (wikilink-style name). " +
          "Returns tasks from all notes when omitted."
      ),
    path: z
      .string()
      .optional()
      .describe("Exact vault-root path, e.g. `folder/note.md`."),
  };

  // ---------------------------------------------------------------------------
  // tasks_all — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "tasks_all",
    "List all tasks (completed and pending) in the vault, or in a specific note.",
    fileSchema,
    async ({ file, path }) => {
      const args = ["tasks", "all", ...buildFileArgs(file, path)];
      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // tasks_pending — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "tasks_pending",
    "List only pending (uncompleted) tasks in the vault, or in a specific note.",
    fileSchema,
    async ({ file, path }) => {
      const args = ["tasks", "pending", ...buildFileArgs(file, path)];
      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // tasks_daily — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "tasks_daily",
    "List pending tasks in today's daily note.",
    {},
    async () => {
      try {
        const output = await runObsidian(["tasks", "daily", "todo"]);
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
