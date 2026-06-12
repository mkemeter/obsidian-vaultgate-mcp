import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { buildFileArgs, dryRunPreview, dryRunSchema } from "./_helpers.js";

/**
 * Registers frontmatter/properties tools on the MCP server.
 *
 * Tools registered:
 * - `property_read` — read YAML frontmatter of a note (read-only)
 * - `property_set`  — set a frontmatter property (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerPropertyTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // property_read — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "property_read",
    "Read a specific YAML frontmatter property from a note.",
    {
      name: z.string().describe("Property name (frontmatter key) to read, e.g. `status`, `tags`."),
      file: z
        .string()
        .optional()
        .describe("Note name (wikilink-style). Uses the active file when omitted."),
      path: z.string().optional().describe("Exact vault-root path, e.g. `folder/note.md`."),
    },
    async ({ name, file, path }) => {
      const args = ["property:read", `name=${name}`, ...buildFileArgs(file, path)];
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
  // property_set — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "property_set",
    "Set a frontmatter property on a note.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      name: z.string().describe("Property name (frontmatter key)."),
      value: z.string().describe("New value for the property."),
      file: z
        .string()
        .optional()
        .describe("Note name (wikilink-style). Uses the active file when omitted."),
      path: z.string().optional().describe("Exact vault-root path, e.g. `folder/note.md`."),
      dryRun: dryRunSchema,
    },
    async ({ name, value, file, path, dryRun }) => {
      const args = ["property:set", `name=${name}`, `value=${value}`, ...buildFileArgs(file, path)];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Set ${name}=${value}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
