import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { buildFileArgs, optionalBoolSchema } from "./_helpers.js";

/**
 * Registers tag and link analysis tools on the MCP server.
 *
 * All tools in this module are read-only.
 *
 * Tools registered:
 * - `tags`        — list vault tags with optional usage counts
 * - `backlinks`   — list notes that link to a given note
 * - `unresolved`  — list unresolved (broken) links in the vault
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerTagTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // tags — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "tags",
    "List all tags in the vault, optionally with usage counts.",
    {
      sort: z.enum(["name", "count"]).optional().describe("Sort order: by name or by usage count."),
      counts: optionalBoolSchema.describe("Include usage count next to each tag."),
    },
    async ({ sort, counts }) => {
      const args = ["tags"];
      if (sort) args.push(`sort=${sort}`);
      if (counts) args.push("counts");

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
  // backlinks — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "backlinks",
    "List all notes that link to the specified note.",
    {
      file: z
        .string()
        .optional()
        .describe("Note name (wikilink-style). Uses the active file when omitted."),
      path: z.string().optional().describe("Exact vault-root path, e.g. `folder/note.md`."),
    },
    async ({ file, path }) => {
      const args = ["backlinks", ...buildFileArgs(file, path)];
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
  // unresolved — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "unresolved",
    "List all unresolved (broken) links in the vault — links that point to notes that do not exist.",
    {},
    async () => {
      try {
        const output = await runObsidian(["unresolved"]);
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
