import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { dryRunPreview, buildFileArgs, dryRunSchema, optionalBoolSchema } from "./_helpers.js";

/**
 * Registers file and note operation tools on the MCP server.
 *
 * Tools registered:
 * - `files_list`    — list all files in the vault (read-only)
 * - `files_read`    — read a note's content (read-only)
 * - `note_create`   — create or overwrite a note (destructive, dryRun gated)
 * - `note_append`   — append content to an existing note (destructive, dryRun gated)
 * - `note_prepend`  — prepend content to an existing note (destructive, dryRun gated)
 * - `note_update`   — replace the full content of an existing note (destructive, dryRun gated)
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
        .preprocess(
          (v) => (typeof v === "string" ? Number(v) : v),
          z.number().int().positive().optional()
        )
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
      "To create a note inside a subfolder, use the `path` parameter " +
      "(e.g. `Projects/2026-06 My Note.md`). Use `name` only for vault-root notes " +
      "whose name contains no '/'.\n\n" +
      "NOTE: When `overwrite` is false (the default) and a note at that path already " +
      "exists, Obsidian creates a suffixed duplicate (e.g. `Note 1.md`) rather than " +
      "returning an error. To replace an existing note, pass `overwrite: true` or " +
      "use `note_update` instead.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      name: z
        .string()
        .optional()
        .describe(
          "Name for the new note at the vault root (no extension needed, no '/'). " +
            "Use `path` instead for subfolder locations."
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Exact path from the vault root, e.g. `Projects/2026-06 My Note.md`. " +
            "Use this for notes inside subfolders. Takes precedence over `name`."
        ),
      content: z.string().optional().describe("Initial note content."),
      template: z
        .string()
        .optional()
        .describe("Template name to apply when creating the note."),
      overwrite: optionalBoolSchema.describe(
          "Overwrite the note if it already exists. Defaults to false."
        ),
      silent: optionalBoolSchema.describe(
          "Do not open the note after creation. Defaults to false."
        ),
      dryRun: dryRunSchema,
    },
    async ({ name, path, content, template, overwrite, silent, dryRun }) => {
      const args = ["create"];
      if (path !== undefined) {
        args.push(`path=${path}`);
      } else if (name !== undefined) {
        args.push(`name=${name}`);
      }
      if (content) args.push(`content=${content}`);
      if (template) args.push(`template=${template}`);
      if (overwrite) args.push("overwrite");
      if (silent) args.push("silent");

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Created: ${path ?? name}` }] };
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
      dryRun: dryRunSchema,
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

  // ---------------------------------------------------------------------------
  // note_prepend — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "note_prepend",
    "Prepend content to the top of an existing note. Useful for reverse-chronological notes " +
      "such as HR records, meeting logs, and journals.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      content: z.string().describe("Content to prepend. Use \\n for newlines."),
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
      dryRun: dryRunSchema,
    },
    async ({ content, file, path, dryRun }) => {
      const args = ["prepend", `content=${content}`, ...buildFileArgs(file, path)];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || "Content prepended." }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // note_update — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "note_update",
    "Replace the full content of an existing note identified by its exact vault path. " +
      "Use this instead of note_create when updating a note that already exists — it ensures " +
      "the correct file is targeted and never creates a duplicate at the vault root.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      path: z
        .string()
        .describe(
          "Exact path of the note from the vault root, e.g. `HR/Jona Kuhn.md`. " +
            "Use files_list to find the correct path."
        ),
      content: z.string().describe("New full content for the note."),
      dryRun: dryRunSchema,
    },
    async ({ path, content, dryRun }) => {
      // `create path=<path> content=<content> overwrite` replaces the full file content.
      const args = ["create", `path=${path}`, `content=${content}`, "overwrite"];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Updated: ${path}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // note_trash — destructive (dryRun gated)
  // ---------------------------------------------------------------------------
  server.tool(
    "note_trash",
    "Move a note to the system trash (recoverable). " +
      "Use this instead of eval+app.vault.trash() for safe, auditable note deletion.\n\n" +
      "IMPORTANT: Always call with dryRun=true first, show the user the preview, " +
      "and ask for explicit confirmation before calling with dryRun=false.",
    {
      path: z
        .string()
        .describe(
          "Exact path of the note from the vault root, e.g. `HR/Jona Kuhn.md`. " +
            "Use files_list to find the correct path."
        ),
      dryRun: dryRunSchema,
    },
    async ({ path, dryRun }) => {
      const args = ["delete", `path=${path}`];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Moved to trash: ${path}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: (error as Error).message }],
          isError: true,
        };
      }
    }
  );
}
