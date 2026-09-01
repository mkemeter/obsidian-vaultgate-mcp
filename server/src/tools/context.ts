import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runObsidian } from "../cli.js";
import { config } from "../config.js";
import { dryRunPreview, dryRunSchema, errorMessage } from "./_helpers.js";

export const NOT_FOUND_MESSAGE =
  "No vault conventions file found in the vault root.\n\n" +
  "The vault conventions file is an optional note that documents conventions for AI assistants " +
  "(folder structure, naming rules, tag taxonomy, frontmatter schema, template usage, etc.).\n\n" +
  'To create one, ask your AI assistant: "Help me set up vault conventions" — ' +
  "it will analyse your vault and draft the conventions file using `vault_context_set`.";

/**
 * Prefix prepended to the first tool result of a session when vault conventions
 * are submarined in. Generic — does not mention the configurable filename.
 * Plain prose — must not match JWD's high-confidence prompt-injection regexes.
 */
export const CONVENTIONS_ENVELOPE_PREFIX = "[Vault conventions for this session]\n\n";

/** Returns true when an error message indicates the conventions file was not found. */
function isNotFoundError(msg: string): boolean {
  return (
    msg.includes("not found") ||
    msg.includes("ENOENT") ||
    msg.includes("does not exist") ||
    msg.includes("No such file")
  );
}

/**
 * Installs a context guard on the server.
 *
 * Wraps every subsequently registered tool handler so that the vault conventions
 * file is automatically fetched and merged into the first non-error tool result of
 * each conversation — without requiring the model to explicitly call `vault_context`.
 *
 * Uses a TTL-based approach to handle MCP clients (e.g. Joule Desktop) that reuse
 * the same MCP session across multiple chat threads. The TTL (from
 * `config.injectIntervalSecs`) acts as a conversation boundary detector: tool calls
 * within a single thread happen seconds apart, so conventions are delivered exactly
 * once per new conversation.
 *
 * Behaviour on each non-`vault_context`, non-`isError` tool call:
 * - Injection disabled (`config.injectConventions=false`) → pass through unchanged.
 * - Within TTL of last injection → pass through unchanged.
 * - TTL expired → fetch conventions from CLI and merge into first text block.
 *   - File found     → merge, update `lastInjectedAt`.
 *   - File absent    → update `lastInjectedAt` (accept, no retry within TTL).
 *   - Transient error → leave `lastInjectedAt` unchanged (retry on next call).
 *
 * `vault_context` calls update `lastInjectedAt` and return their result untouched.
 * `isError` results are never decorated.
 *
 * Call this BEFORE any `register*Tools(server)` invocation so every tool is wrapped.
 *
 * @param server  The McpServer instance to guard.
 */
export function installContextGuard(server: McpServer): void {
  let lastInjectedAt = 0;
  const original = server.tool.bind(server);

  // biome-ignore lint/suspicious/noExplicitAny: wrapping variadic overloads requires any
  (server as any).tool = (...args: any[]) => {
    const handlerIndex = args.reduce(
      (last: number, a: unknown, i: number) => (typeof a === "function" ? i : last),
      -1
    );
    if (handlerIndex === -1) {
      // biome-ignore lint/suspicious/noExplicitAny: pass-through variadic
      return (original as any)(...args);
    }

    const originalHandler = args[handlerIndex];
    const toolName: string = args[0];

    const wrapped = async (...handlerArgs: unknown[]) => {
      const result = await originalHandler(...handlerArgs);

      if (toolName === "vault_context") {
        lastInjectedAt = Date.now();
        return result;
      }

      const now = Date.now();
      const ttlMs = config.injectIntervalSecs * 1000;
      if (!config.injectConventions || now - lastInjectedAt < ttlMs || result?.isError) {
        return result;
      }

      // Attempt to fetch and submarine the conventions into this result.
      try {
        const conventions = await runObsidian(["read", `path=${config.contextFileName}`]);
        lastInjectedAt = Date.now();

        // Merge into the existing first text block to avoid multi-block rendering issues.
        const content: Array<{ type: string; text: string }> = result?.content ?? [];
        const firstTextIdx = content.findIndex((c) => c.type === "text");
        const firstBlock = firstTextIdx !== -1 ? content[firstTextIdx] : undefined;
        if (firstBlock !== undefined) {
          const merged = [...content];
          merged[firstTextIdx] = {
            type: "text",
            text: `${CONVENTIONS_ENVELOPE_PREFIX + conventions}\n\n---\n\n${firstBlock.text}`,
          };
          return { ...result, content: merged };
        }
        // No existing text block — prepend one.
        return {
          ...result,
          content: [{ type: "text", text: CONVENTIONS_ENVELOPE_PREFIX + conventions }, ...content],
        };
      } catch (error) {
        const msg = errorMessage(error) ?? "";
        if (isNotFoundError(msg)) {
          // File absent — accept this state, don't retry within TTL.
          lastInjectedAt = Date.now();
        }
        // Transient error: leave lastInjectedAt unchanged so next call retries.
        return result;
      }
    };

    const newArgs = [...args];
    newArgs[handlerIndex] = wrapped;
    // biome-ignore lint/suspicious/noExplicitAny: pass-through variadic
    return (original as any)(...newArgs);
  };
}

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
    "Read the vault owner's conventions from the vault conventions file: folder structure, " +
      "task format, naming rules, tag taxonomy, frontmatter schema, template usage, and writing style. " +
      "Call this tool at the start of every session, before creating notes, appending content, or " +
      "writing anything to the vault, so that all output matches the vault's established conventions.",
    {},
    async () => {
      try {
        const content = await runObsidian(["read", `path=${config.contextFileName}`]);
        return { content: [{ type: "text", text: content }] };
      } catch (error) {
        const msg = errorMessage(error) ?? "";
        if (isNotFoundError(msg)) {
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
          content: [{ type: "text", text: errorMessage(error) }],
          isError: true,
        };
      }
    }
  );
}
