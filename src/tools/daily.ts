import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview, dryRunSchema } from "./_helpers.js";

/**
 * Registers daily note tools on the MCP server.
 *
 * Tools registered:
 * - `daily_read`   — read today's daily note (read-only)
 * - `daily_append` — append content to today's daily note (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerDailyTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // daily_read — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "daily_read",
    "Read today's daily note from the vault.",
    {},
    async () => {
      try {
        const output = await runObsidian(["daily:read"]);
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
  // daily_append — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "daily_append",
    "Append content to today's daily note.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      content: z
        .string()
        .describe(
          "Content to append. Use \\n for newlines, e.g. '- [ ] Task one\\n- [ ] Task two'."
        ),
      dryRun: dryRunSchema,
    },
    async ({ content, dryRun }) => {
      const args = ["daily:append", `content=${content}`];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || "Content appended to daily note." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
