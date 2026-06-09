import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview } from "./_helpers.js";

/**
 * Registers plugin management tools on the MCP server.
 *
 * Tools registered:
 * - `plugins_list`   — list installed plugins with versions (read-only)
 * - `plugin_reload`  — reload a plugin to pick up code changes (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerPluginTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // plugins_list — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "plugins_list",
    "List all installed plugins in the vault with their version numbers.",
    {},
    async () => {
      try {
        const output = await runObsidian(["plugins", "list"]);
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
  // plugin_reload — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "plugin_reload",
    "Reload a plugin to pick up code changes. Primarily useful during plugin development.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      id: z
        .string()
        .describe(
          "Plugin ID (the folder name of the plugin, e.g. `dataview` or `templater-obsidian`)."
        ),
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "When true (default), returns a preview without executing. " +
            "Set to false only after explicit user confirmation."
        ),
    },
    async ({ id, dryRun }) => {
      const args = ["plugin:reload", `id=${id}`];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Plugin "${id}" reloaded.` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
