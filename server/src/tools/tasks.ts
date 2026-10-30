import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { config } from "../config.js";
import { isNoteInScope, isPathBlocked, isScopingEnabled, SCOPE_BLOCKED_MESSAGE } from "../scope.js";
import { buildFileArgs, errorMessage } from "./_helpers.js";

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
    path: z.string().optional().describe("Exact vault-root path, e.g. `folder/note.md`."),
  };

  // ---------------------------------------------------------------------------
  // tasks_all — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "tasks_all",
    "List all tasks (completed and pending) in the vault, or in a specific note.",
    fileSchema,
    async ({ file, path }) => {
      const notePath = path?.trim() || file?.trim();
      if (isPathBlocked(notePath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
      if (!notePath && isScopingEnabled()) {
        return {
          content: [
            {
              type: "text",
              text: "Vault-wide task listing is not available when vault scoping is active. Provide a specific note path or file to query tasks within the current scope.",
            },
          ],
          isError: true,
        };
      }
      const args = ["tasks", "all", ...buildFileArgs(file, path)];
      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: errorMessage(error) }],
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
      const notePath = path?.trim() || file?.trim();
      if (isPathBlocked(notePath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
      if (!notePath && isScopingEnabled()) {
        return {
          content: [
            {
              type: "text",
              text: "Vault-wide task listing is not available when vault scoping is active. Provide a specific note path or file to query tasks within the current scope.",
            },
          ],
          isError: true,
        };
      }
      const args = ["tasks", "todo", ...buildFileArgs(file, path)];
      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: errorMessage(error) }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // tasks_daily — read-only
  // ---------------------------------------------------------------------------
  server.tool("tasks_daily", "List pending tasks in today's daily note.", {}, async () => {
    if (isScopingEnabled() && config.dailyNotesPath) {
      const dateStr = new Date().toISOString().slice(0, 10);
      const dailyPath = `${config.dailyNotesPath}/${dateStr}.md`;
      if (!isNoteInScope(dailyPath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
    }
    try {
      const output = await runObsidian(["tasks", "daily", "todo"]);
      return { content: [{ type: "text", text: output }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: errorMessage(error) }],
        isError: true,
      };
    }
  });
}
