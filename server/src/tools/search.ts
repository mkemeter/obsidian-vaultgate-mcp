import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { isScopingEnabled } from "../scope.js";
import { errorMessage } from "./_helpers.js";

/**
 * Registers the vault search tool on the MCP server.
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerSearchTools(server: McpServer): void {
  server.tool(
    "search",
    "Search the Obsidian vault using keyword matching. Returns matching notes with context snippets. For meaning-based or fuzzy queries, use semantic_search instead. Not available when vault scoping is active — use files_list or semantic_search instead.",
    {
      query: z.string().describe("Search term or phrase to look for."),
      limit: z
        .preprocess(
          (v) => (typeof v === "string" ? Number(v) : v),
          z.number().int().positive().optional()
        )
        .describe("Maximum number of results to return."),
    },
    async ({ query, limit }) => {
      if (isScopingEnabled()) {
        return {
          content: [
            {
              type: "text",
              text: "Full-vault search is unavailable when vault scoping is active — it uses Obsidian's native vault-wide search, which cannot be restricted to a scope. Use files_list to browse notes in the current scope, or semantic_search for meaning-based queries.",
            },
          ],
          isError: true,
        };
      }
      const args = ["search", `query=${query}`];
      if (limit !== undefined) args.push(`limit=${limit}`);

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
}
