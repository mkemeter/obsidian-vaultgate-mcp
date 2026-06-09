import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview, buildFileArgs } from "./_helpers.js";

/**
 * Registers file and note operation tools on the MCP server.
 *
 * Tools registered:
 * - `files_list`  — list all files in the vault (read-only)
 * - `files_read`  — read a note's content (read-only)
 * - `note_create` — create or overwrite a note (destructive, dryRun gated)
 * - `note_append` — append content to an existing note (destructive, dryRun gated)
 *
 * @param server  The MCP server instance to register tools on.
 */
export function registerFileTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // files_list — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "files_list",
    "List all files in the Obsidian vault. Returns a newline-separated list of file paths relative to the vault root.",
    {
      sort: z
        .enum(["name", "modified", "created"])
        .optional()
        .describe("Sort order for the file listing."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of files to return."),
    },
    async ({ sort, limit }) => {
      const args = ["files", "list"];
      if (sort) args.push(`sort=${sort}`);
      if (limit !== undefined) args.push(`limit=${limit}`);

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
  // files_read — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "files_read",
    "Read the full content of a note in the vault.",
    {
      file: z
        .string()
        .optional()
        .describe(
          "Note name (resolved like a wikilink — no path or extension needed). " +
            "Uses the active file when omitted."
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Exact path from the vault root, e.g. `folder/note.md`. " +
            "Takes precedence over `file` when both are provided."
        ),
    },
    async ({ file, path }) => {
      const args = ["read", ...buildFileArgs(file, path)];

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
  // note_create — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "note_create",
    "Create a new note in the vault, optionally from a template.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      name: z.string().describe("Name for the new note (no extension needed)."),
      content: z.string().optional().describe("Initial note content."),
      template: z
        .string()
        .optional()
        .describe("Template name to apply when creating the note."),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite the note if it already exists. Defaults to false."),
      silent: z
        .boolean()
        .optional()
        .describe("Do not open the note after creation. Defaults to false."),
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "When true (default), returns a preview of the command without executing it. " +
            "Set to false only after showing the user the preview and receiving explicit confirmation."
        ),
    },
    async ({ name, content, template, overwrite, silent, dryRun }) => {
      const args = ["create", `name=${name}`];
      if (content) args.push(`content=${content}`);
      if (template) args.push(`template=${template}`);
      if (overwrite) args.push("overwrite");
      if (silent) args.push("silent");

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Created: ${name}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // note_append — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "note_append",
    "Append content to an existing note.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      content: z.string().describe("Content to append. Use \\n for newlines."),
      file: z
        .string()
        .optional()
        .describe(
          "Note name (wikilink-style). Uses the active file when omitted."
        ),
      path: z
        .string()
        .optional()
        .describe("Exact path from vault root, e.g. `folder/note.md`."),
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "When true (default), returns a preview without executing. " +
            "Set to false only after explicit user confirmation."
        ),
    },
    async ({ content, file, path, dryRun }) => {
      const args = ["append", `content=${content}`, ...buildFileArgs(file, path)];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || "Content appended." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
