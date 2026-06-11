import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { registerFileTools } from "./tools/files.js";
import { registerSearchTools } from "./tools/search.js";
import { registerDailyTools } from "./tools/daily.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerTagTools } from "./tools/tags.js";
import { registerPluginTools } from "./tools/plugins.js";
import { registerDevTools } from "./tools/dev.js";
import { registerContextTools } from "./tools/context.js";
import { runObsidian } from "./cli.js";

/** Number of always-present tools (includes vault_context + vault_context_set). */
export const BASE_TOOL_COUNT = 31;

/** Number of additional tools registered when @xenova/transformers is available. */
export const SEMANTIC_TOOL_COUNT = 5;

/** Raw SVG icon string — used in HTTP mode where the server can serve it directly. */
export function getIconSvg(): string {
  const iconPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "icon.svg");
  try {
    return fs.readFileSync(iconPath, "utf-8");
  } catch {
    return "";
  }
}

/** Raw favicon.ico bytes — served at /favicon.ico so JWD can display the server icon. */
export function getFaviconIco(): Buffer | null {
  const icoPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "favicon.ico");
  try {
    return fs.readFileSync(icoPath);
  } catch {
    return null;
  }
}

/** SVG icon as a base64 data URI — used in stdio mode where no URL is available. */
export function getIconDataUri(): string {
  const svg = getIconSvg();
  return svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` : "";
}

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
 * @param iconUrl  Optional HTTP URL for the icon (HTTP mode only, served at /icon.svg).
 *                 The data URI is always embedded for maximum client compatibility.
 * @returns  A fully configured `McpServer` with all tools registered.
 */
export async function createServer(iconUrl?: string): Promise<McpServer> {
  const dataUri = getIconDataUri();

  const serverInfo: ConstructorParameters<typeof McpServer>[0] = {
    name: "obsidian-vaultgate-mcp",
    version: "0.1.0",
  };

  if (dataUri) {
    const meta = serverInfo as Record<string, unknown>;
    // Flat string — used by some clients (e.g. older MCP implementations)
    meta.icon = dataUri;
    // Array form — MCP spec 2025-11-25 standard
    meta.icons = [
      { src: dataUri, mimeType: "image/svg+xml" },
      // Also include the HTTP URL if available so clients can cache/display it
      ...(iconUrl ? [{ src: iconUrl, mimeType: "image/svg+xml" }] : []),
    ];
  }

  // Read VAULTGATE.md and inject as instructions so compliant MCP clients
  // receive vault conventions automatically at session start.
  let vaultInstructions: string | undefined;
  try {
    const raw = await runObsidian(["read", "path=VAULTGATE.md"]);
    if (raw.trim()) {
      vaultInstructions =
        raw.trim() +
        "\n\n> Vault context received. You do not need to call `vault_context`.";
    }
  } catch {
    // File absent or vault not reachable — skip silently.
  }

  const server = new McpServer(serverInfo, { instructions: vaultInstructions });

  registerFileTools(server);      // files_list, files_read, note_create, note_append, note_prepend, note_update, note_trash
  registerSearchTools(server);    // search
  registerDailyTools(server);     // daily_read, daily_append
  registerTaskTools(server);      // tasks_all, tasks_pending, tasks_daily
  registerTemplateTools(server);  // templates_list, templates_apply
  registerPropertyTools(server);  // property_read, property_set
  registerTagTools(server);       // tags, backlinks, unresolved
  registerPluginTools(server);    // plugins_list, plugin_reload
  registerDevTools(server);       // eval, dev_errors, dev_console, dev_css, dev_dom, dev_screenshot, dev_mobile
  registerContextTools(server);   // vault_context, vault_context_set

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
