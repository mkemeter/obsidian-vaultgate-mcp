import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runUri } from "../uri.js";

/**
 * Registers URI navigation tools on the MCP server.
 *
 * These tools dispatch obsidian:// URIs through the OS launcher to trigger
 * GUI navigation inside the running Obsidian instance. They do not read or
 * write vault data — use the CLI tools for that.
 *
 * Tools registered:
 * - `note_open`   — open a note in the Obsidian GUI
 * - `search_open` — open the search panel with a pre-filled query
 * - `daily_open`  — open today's daily note in the Obsidian GUI
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerUriTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // note_open
  // ---------------------------------------------------------------------------
  server.tool(
    "note_open",
    "Open a note in the Obsidian GUI, bringing Obsidian to the foreground. " +
      "Use after reading or writing a note to show it to the user. " +
      "Provide `path` (vault-root path, e.g. 'Projects/My Note.md') or `file` (wikilink name). " +
      "`path` takes precedence. Use `heading` or `block` to scroll to a specific location.",
    {
      file: z.string().optional().describe("Note name as a wikilink (no path or extension)."),
      path: z
        .string()
        .optional()
        .describe("Vault-root path, e.g. 'Folder/Note.md'. Takes precedence over file."),
      heading: z
        .string()
        .optional()
        .describe("Heading to scroll to (without the # prefix)."),
      block: z
        .string()
        .optional()
        .describe("Block ID to jump to (without the ^ prefix)."),
    },
    async ({ file, path, heading, block }) => {
      const fileValue = path ?? file;
      if (!fileValue) {
        return {
          content: [{ type: "text", text: "Either `file` or `path` must be provided." }],
          isError: true,
        };
      }
      const params: Record<string, string> = { file: fileValue };
      if (heading) params.heading = heading;
      if (block) params.block = block;
      try {
        await runUri("open", params);
        return { content: [{ type: "text", text: `Opened '${fileValue}' in Obsidian.` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // search_open
  // ---------------------------------------------------------------------------
  server.tool(
    "search_open",
    "Open the Obsidian search panel with a pre-filled query, bringing Obsidian to the foreground. " +
      "Complements the headless `search` tool: use this to let the user browse results in the Obsidian UI.",
    {
      query: z.string().describe("Search query to pre-fill in Obsidian's search panel."),
    },
    async ({ query }) => {
      try {
        await runUri("search", { query });
        return { content: [{ type: "text", text: `Opened Obsidian search for: ${query}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // daily_open
  // ---------------------------------------------------------------------------
  server.tool(
    "daily_open",
    "Open today's daily note in the Obsidian GUI, bringing Obsidian to the foreground. " +
      "Use after reading or appending to the daily note so the user can review it directly.",
    {},
    async () => {
      try {
        await runUri("daily", {});
        return { content: [{ type: "text", text: "Opened today's daily note in Obsidian." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
