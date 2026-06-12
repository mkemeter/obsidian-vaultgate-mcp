import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview, dryRunSchema } from "./_helpers.js";

const VAULTGATE_FILE = "VAULTGATE.md";

const NOT_FOUND_MESSAGE =
  "No VAULTGATE.md found in the vault root.\n\n" +
  "VAULTGATE.md is an optional file that documents vault conventions for AI assistants " +
  "(folder structure, naming rules, tag taxonomy, frontmatter schema, template usage, etc.).\n\n" +
  'To create one, ask your AI assistant: "Help me set up vault conventions" — ' +
  "it will analyse your vault and draft a VAULTGATE.md using `vault_context_set`.";

/**
 * Registers vault-convention tools on the MCP server.
 *
 * Tools registered:
 * - `vault_context`     — read VAULTGATE.md (read-only, fallback for non-compliant clients)
 * - `vault_context_set` — create or update VAULTGATE.md (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerContextTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // vault_context — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "vault_context",
    "Read vault conventions from VAULTGATE.md. " +
      "Only call this if vault conventions were not already provided at session start. " +
      "Returns guidance on folder structure, naming rules, tag taxonomy, frontmatter schema, " +
      "template usage, and any other conventions the vault owner has documented.",
    {},
    async () => {
      try {
        const content = await runObsidian(["read", `path=${VAULTGATE_FILE}`]);
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        const msg = (error as Error).message ?? "";
        // Distinguish "file not found" from unexpected CLI errors
        if (
          msg.includes("not found") ||
          msg.includes("ENOENT") ||
          msg.includes("does not exist") ||
          msg.includes("No such file")
        ) {
          return { content: [{ type: "text", text: NOT_FOUND_MESSAGE }] };
        }
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // vault_context_set — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "vault_context_set",
    "Create or update VAULTGATE.md — the vault conventions file read by AI assistants at session start.\n\n" +
      "Before drafting content, analyse the vault: call files_list to see the folder structure, " +
      "templates_list to catalogue templates, tags to see the tag taxonomy, and property_read " +
      "on a few representative notes to understand frontmatter conventions.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      content: z.string().describe("Full Markdown content to write to VAULTGATE.md."),
      dryRun: dryRunSchema,
    },
    async ({ content, dryRun }) => {
      const args = ["create", `name=${VAULTGATE_FILE}`, `content=${content}`, "overwrite"];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        await runObsidian(args);
        return { content: [{ type: "text", text: "VAULTGATE.md updated." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
