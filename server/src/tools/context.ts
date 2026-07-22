import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { config } from "../config.js";
import { dryRunPreview, dryRunSchema } from "./_helpers.js";

const NOT_FOUND_MESSAGE =
  "No vault conventions file found in the vault root.\n\n" +
  "The vault conventions file is an optional note that documents conventions for AI assistants " +
  "(folder structure, naming rules, tag taxonomy, frontmatter schema, template usage, etc.).\n\n" +
  'To create one, ask your AI assistant: "Help me set up vault conventions" — ' +
  "it will analyse your vault and draft the conventions file using `vault_context_set`.";

/**
 * Registers vault-convention tools on the MCP server.
 *
 * Tools registered:
 * - `vault_context`     — read the vault conventions file (read-only, fallback for non-compliant clients)
 * - `vault_context_set` — create or update the vault conventions file (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerContextTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // vault_context — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "vault_context",
    "Read the vault owner's conventions from the vault conventions file: folder structure, task format, " +
      "naming rules, tag taxonomy, frontmatter schema, template usage, and writing style. " +
      "Call this at the start of every session — before creating notes, appending tasks, or " +
      "writing any content — so that all output matches the vault's established conventions. " +
      "Skip only if vault conventions were already included in the server's system instructions.",
    {},
    async () => {
      try {
        const content = await runObsidian(["read", `path=${config.contextFileName}`]);
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
    "Create or update the vault conventions file — the conventions note read by AI assistants at session start.\n\n" +
      "Before drafting content, analyse the vault: call files_list to see the folder structure, " +
      "templates_list to catalogue templates, tags to see the tag taxonomy, and property_read " +
      "on a few representative notes to understand frontmatter conventions.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      content: z.string().describe("Full Markdown content to write to the vault conventions file."),
      dryRun: dryRunSchema,
    },
    async ({ content, dryRun }) => {
      const args = ["create", `name=${config.contextFileName}`, `content=${content}`, "overwrite"];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        await runObsidian(args);
        return { content: [{ type: "text", text: "Vault conventions file updated." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
