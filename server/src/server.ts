import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InitializeRequestSchema,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { runObsidian } from "./cli.js";
import { config } from "./config.js";
import { resolveInterpolations, setClientName } from "./interpolate.js";
import { extractBody, getConventionsPaths, initScopeEngine, isScopingEnabled } from "./scope.js";
import { installContextGuard, registerContextTools } from "./tools/context.js";
import { registerDailyTools } from "./tools/daily.js";
import { registerDevTools } from "./tools/dev.js";
import { registerFileTools } from "./tools/files.js";
import { registerPluginTools } from "./tools/plugins.js";
import { registerPropertyTools } from "./tools/properties.js";
import { registerScopeTools } from "./tools/scope.js";
import { registerSearchTools } from "./tools/search.js";
import { registerTagTools } from "./tools/tags.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTemplateTools } from "./tools/templates.js";
import { registerUriTools } from "./tools/uri.js";

/** Number of always-present tools (includes vault_context + vault_context_set). */
export const BASE_TOOL_COUNT = 32;

/** Number of URI-scheme tools registered unless VAULTGATE_NO_URI=true. */
export const URI_TOOL_COUNT = 3;

/** Number of additional tools registered when @huggingface/transformers is available. */
export const SEMANTIC_TOOL_COUNT = 5;

/** Number of additional tools registered when vault scoping is enabled. */
export const SCOPE_TOOL_COUNT = 1;

/** Number of additional tools registered when vault scope switching is enabled. */
export const SCOPE_SWITCHING_TOOL_COUNT = 1;

/** Raw SVG icon string — used in HTTP mode where the server can serve it directly. */
export function getIconSvg(): string {
  const iconPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "icon.svg");
  try {
    return fs.readFileSync(iconPath, "utf-8");
  } catch {
    /* c8 ignore next */
    return "";
  }
}

/** Raw favicon.ico bytes — served at /favicon.ico so JWD can display the server icon. */
export function getFaviconIco(): Buffer | null {
  const icoPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "favicon.ico");
  try {
    return fs.readFileSync(icoPath);
  } catch {
    /* c8 ignore next */
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
 * Semantic search tools (semantic_search, find_similar, index_vault, clear_index, vault_info)
 * are registered automatically when @huggingface/transformers is available on the
 * platform. If the optional dependency is absent the server starts normally
 * with BASE_TOOL_COUNT tools.
 *
 * @param iconUrl  Optional HTTP URL for the icon (HTTP mode only, served at /icon.svg).
 *                 The data URI is always embedded for maximum client compatibility.
 * @returns  A fully configured `McpServer` with all tools registered.
 */
export async function createServer(iconUrl?: string): Promise<McpServer> {
  const dataUri = getIconDataUri();

  const pkgPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "package.json");
  const pkgVersion: string = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;

  const serverInfo: ConstructorParameters<typeof McpServer>[0] = {
    name: "obsidian-vaultgate-mcp",
    version: pkgVersion,
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

  const server = new McpServer(serverInfo);

  // Initialise vault scoping before tool registration so filters are active
  // when tools are first called. Self-enables only when scope zones are found
  // via CLI discovery — vaults without scope frontmatter behave as before.
  await initScopeEngine(config.homeScope, config.scopeSwitchingEnabled);
  if (isScopingEnabled() && !config.dailyNotesPath) {
    console.error(
      "[VaultGate] OBSIDIAN_DAILY_NOTES_PATH not set — daily note tools will not enforce scope. " +
        "Set it to the vault-relative folder for daily notes (e.g. 'Daily Notes')."
    );
  }

  // Install the per-session context guard before any tools are registered so
  // every tool handler is wrapped. Until vault_context is called at least once,
  // non-error results get a short reminder prepended nudging the model to load
  // vault conventions first.
  installContextGuard(server);

  // Lazily inject the vault conventions file as MCP instructions when a client
  // initialises. Overrides the default initialize handler on the inner Server so
  // Obsidian is only contacted when a client actually connects — not at startup.
  server.server.setRequestHandler(InitializeRequestSchema, async (request) => {
    setClientName(request.params.clientInfo?.name ?? "unknown");
    let vaultInstructions: string | undefined;
    try {
      const conventionsPaths = getConventionsPaths();
      const parts: string[] = [];
      for (const filePath of conventionsPaths) {
        try {
          const content = await runObsidian(["read", `path=${filePath}`]);
          parts.push(extractBody(content));
        } catch {
          if (filePath === conventionsPaths[0])
            throw new Error("primary conventions file not found");
        }
      }
      const raw = resolveInterpolations(parts.join("\n\n---\n\n"));
      if (raw.trim()) {
        vaultInstructions = raw.trim();
      }
    } catch {
      // File absent or vault not reachable — skip silently.
    }
    const requestedVersion = request.params.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
      ? requestedVersion
      : LATEST_PROTOCOL_VERSION;
    // Access capabilities via the underlying Server (typed as unknown to reach the
    // public-at-runtime but type-private getCapabilities method).
    // biome-ignore lint/suspicious/noExplicitAny: getCapabilities() is public at runtime but private in TS types
    const capabilities = (server.server as any).getCapabilities();
    return {
      protocolVersion,
      capabilities,
      serverInfo: { name: "obsidian-vaultgate-mcp", version: serverInfo.version },
      ...(vaultInstructions && { instructions: vaultInstructions }),
    };
  });

  registerFileTools(server); // files_list, files_read, note_create, note_append, note_prepend, note_update, note_trash
  registerSearchTools(server); // search
  registerDailyTools(server); // daily_read, daily_append
  registerTaskTools(server); // tasks_all, tasks_pending, tasks_daily
  registerTemplateTools(server); // templates_list, templates_apply
  registerPropertyTools(server); // property_read, property_set, property_search
  registerTagTools(server); // tags, backlinks, unresolved
  registerPluginTools(server); // plugins_list, plugin_reload
  registerDevTools(server); // eval, dev_errors, dev_console, dev_css, dev_dom, dev_screenshot, dev_mobile
  registerContextTools(server); // vault_context, vault_context_set

  // URI tools — registered unless VAULTGATE_NO_URI=true.
  if (!config.noUri) {
    registerUriTools(server); // note_open, search_open, daily_open
  }

  // Scope tools — registered when vault scoping is active (scope zones found in vault).
  if (isScopingEnabled()) {
    registerScopeTools(server);
  }

  // Semantic search tools — optional, require @huggingface/transformers ONNX runtime.
  // Only the import is guarded; if the module loads, registration errors propagate normally.
  let semanticModule: { registerSemanticTools: (s: McpServer) => void } | undefined;
  try {
    semanticModule = await import("./tools/semantic.js");
  } catch {
    // @huggingface/transformers unavailable on this platform — skip semantic tools silently.
  }
  if (semanticModule) {
    semanticModule.registerSemanticTools(server);
  }

  return server;
}
