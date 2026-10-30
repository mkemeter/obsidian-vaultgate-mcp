import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { filterByScope, isPathBlocked, isScopingEnabled, SCOPE_BLOCKED_MESSAGE } from "../scope.js";
import { buildFileArgs, dryRunPreview, dryRunSchema, errorMessage } from "./_helpers.js";

/**
 * Registers frontmatter/properties tools on the MCP server.
 *
 * Tools registered:
 * - `property_read`   — read YAML frontmatter of a note (read-only)
 * - `property_set`    — set a frontmatter property (destructive, dryRun gated)
 * - `property_search` — search notes across the vault by frontmatter field value (read-only)
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
      const notePath = path?.trim() || file?.trim();
      if (notePath === undefined && isScopingEnabled()) {
        console.error(
          "[VaultGate] property_read: no file/path provided with scoping enabled — scope cannot be verified, proceeding."
        );
      } else if (isPathBlocked(notePath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
      const args = ["property:read", `name=${name}`, ...buildFileArgs(file, path)];
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
      const notePath = path?.trim() || file?.trim();
      if (notePath === undefined && isScopingEnabled()) {
        console.error(
          "[VaultGate] property_set: no file/path provided with scoping enabled — scope cannot be verified, proceeding."
        );
      } else if (isPathBlocked(notePath)) {
        return { content: [{ type: "text", text: SCOPE_BLOCKED_MESSAGE }], isError: true };
      }
      const args = ["property:set", `name=${name}`, `value=${value}`, ...buildFileArgs(file, path)];

      if (dryRun) {
        return { content: [{ type: "text", text: dryRunPreview(args) }] };
      }

      try {
        const output = await runObsidian(args);
        return { content: [{ type: "text", text: output || `Set ${name}=${value}` }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: errorMessage(error) }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // property_search — read-only
  // ---------------------------------------------------------------------------
  server.tool(
    "property_search",
    "Search vault notes by frontmatter field value. Returns a newline-separated list of " +
      "vault-relative paths where the specified key matches the given criteria. Supports " +
      "exact value match, date range (before/after ISO date), key existence check, or " +
      "key absence (missing). Optionally restrict the search to a folder prefix with `path`.",
    {
      key: z.string().describe("Frontmatter key to filter on, e.g. `status`, `assignee`."),
      value: z
        .string()
        .optional()
        .describe("Exact value to match (case-sensitive string comparison)."),
      before: z
        .string()
        .optional()
        .describe(
          "ISO date string (YYYY-MM-DD) — include notes where the key's value is a date strictly before this."
        ),
      after: z
        .string()
        .optional()
        .describe(
          "ISO date string (YYYY-MM-DD) — include notes where the key's value is a date strictly after this."
        ),
      missing: z
        .boolean()
        .optional()
        .describe("If true, return notes that do not have the key at all."),
      path: z
        .string()
        .optional()
        .describe(
          "Vault-relative folder prefix to restrict the search, e.g. `Projects/` or `Projects`."
        ),
    },
    async ({ key, value, before, after, missing, path }) => {
      try {
        const listOutput = await runObsidian(["files", "list"]);
        let files = listOutput.split("\n").filter(Boolean);
        files = filterByScope(files);
        if (path) {
          const prefix = path.endsWith("/") ? path : `${path}/`;
          files = files.filter((f) => f.startsWith(prefix));
        }
        const matches: string[] = [];
        for (const file of files) {
          try {
            const raw = await runObsidian(["property:read", `name=${key}`, `path=${file}`]);
            const propValue = raw.trim();
            if (missing) {
              if (!propValue) matches.push(file);
            } else if (value !== undefined) {
              if (propValue === value) matches.push(file);
            } else if (before !== undefined || after !== undefined) {
              const d = new Date(propValue);
              if (Number.isNaN(d.getTime())) continue;
              if (before !== undefined && d >= new Date(before)) continue;
              if (after !== undefined && d <= new Date(after)) continue;
              matches.push(file);
            } else {
              if (propValue) matches.push(file);
            }
          } catch {
            if (missing) matches.push(file);
          }
        }
        return { content: [{ type: "text", text: matches.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text", text: errorMessage(error) }], isError: true };
      }
    }
  );
}
