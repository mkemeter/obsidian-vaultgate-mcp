import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFileTools } from "./tools/files.js";
import { registerSearchTools } from "./tools/search.js";
import { registerDailyTools } from "./tools/daily.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerTagTools } from "./tools/tags.js";
import { registerPluginTools } from "./tools/plugins.js";
import { registerDevTools } from "./tools/dev.js";

/** Number of always-present tools (includes note_prepend and note_update). */
export const BASE_TOOL_COUNT = 28;

/** Number of additional tools registered when @xenova/transformers is available. */
export const SEMANTIC_TOOL_COUNT = 4;

/**
 * Creates and configures the MCP server with all Obsidian CLI tools.
 *
 * The server instance is transport-agnostic: the same server is used for
 * both stdio (Claude Code) and HTTP (URL-based MCP clients) transports.
 * Callers attach the appropriate transport in `index.ts`.
 *
 * Semantic search tools (semantic_search, find_similar, index_vault, vault_info)
 * are registered automatically when @xenova/transformers is available on the
 * platform. If the optional dependency is absent the server starts normally
 * with BASE_TOOL_COUNT tools.
 *
 * @returns  A fully configured `McpServer` with all tools registered.
 */
export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "obsidian-mcp-http",
    version: "0.1.0",
  });

  registerFileTools(server);      // files_list, files_read, note_create, note_append, note_prepend, note_update
  registerSearchTools(server);    // search
  registerDailyTools(server);     // daily_read, daily_append
  registerTaskTools(server);      // tasks_all, tasks_pending, tasks_daily
  registerTemplateTools(server);  // templates_list, templates_apply
  registerPropertyTools(server);  // property_read, property_set
  registerTagTools(server);       // tags, backlinks, unresolved
  registerPluginTools(server);    // plugins_list, plugin_reload
  registerDevTools(server);       // eval, dev_errors, dev_console, dev_css, dev_dom, dev_screenshot, dev_mobile

  // Semantic search tools — optional, require @xenova/transformers ONNX runtime.
  // Only the import is guarded; if the module loads, registration errors propagate normally.
  let semanticModule: { registerSemanticTools: (s: McpServer) => void } | undefined;
  try {
    semanticModule = await import("./tools/semantic.js");
  } catch {
    // @xenova/transformers unavailable on this platform — skip semantic tools silently.
  }
  if (semanticModule) {
    semanticModule.registerSemanticTools(server);
  }

  return server;
}
