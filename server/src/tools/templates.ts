import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { filterByScope, isPathBlocked, isVaultGateFile, SCOPE_BLOCKED_MESSAGE } from "../scope.js";
import { buildFileArgs, dryRunPreview, dryRunSchema, errorMessage } from "./_helpers.js";

/**
 * Registers template tools on the MCP server.
 *
 * Tools registered:
 * - `templates_list`  — list available templates (read-only)
 * - `templates_apply` — apply a template to a note (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerTemplateTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // templates_list — read-only
  // ---------------------------------------------------------------------------
  server.tool("templates_list", "List all available templates in the vault.", {}, async () => {
    try {
      const output = await runObsidian(["templates", "list"]);
      const lines = output.split("\n").filter((l) => l.trim() !== "");
      const filtered = filterByScope(lines).filter((l) => !isVaultGateFile(l));
      return { content: [{ type: "text", text: filtered.join("\n") }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: errorMessage(error) }],
        isError: true,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // templates_apply — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "templates_apply",
    "Apply a template to a note.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      template: z.string().describe("Name of the template to apply."),
      file: z
        .string()
        .optional()
        .describe("Target note name (wikilink-style). Uses the active file when omitted."),
      path: z.string().optional().describe("Exact vault-root path of the target note."),
      dryRun: dryRunSchema,
    },
    async ({ template, file, path, dryRun }) => {
      // Scope guard: check target note path, not the template itself.
      const notePath = path?.trim() || file?.trim();
      if (isPathBlocked(notePath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
      const args = ["templates", "apply", `template=${template}`, ...buildFileArgs(file, path)];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || "Template applied." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: errorMessage(error) }],
          isError: true,
        };
      }
    }
  );
}
