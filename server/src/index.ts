#!/usr/bin/env node
/**
 * obsidian-vaultgate-mcp entry point.
 *
 * Detects the run mode and starts the appropriate transport:
 *
 * - **stdio mode**: stdin is a pipe (not a TTY) — used when Claude Code
 *   launches this process as a child process. Communicates over stdin/stdout.
 *
 * - **HTTP mode**: stdin is a TTY (interactive terminal) or the process is
 *   started standalone — used for URL-based
 *   clients. Listens on http://127.0.0.1:<PORT>.
 *
 * HTTP mode supports both transports for maximum client compatibility:
 *   POST /mcp       → Streamable HTTP (MCP spec 2025-03-26, modern)
 *   GET  /sse       → SSE (legacy, backward-compatible fallback)
 *   POST /messages  → SSE message handler
 *   GET  /health    → Liveness probe (returns 200 OK)
 *   GET  /icon.svg  → Server icon (SVG)
 *   GET  /favicon.ico → Server icon (ICO)
 */

import * as http from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config, setVault } from "./config.js";
import { runHealthCheck } from "./health.js";
import { createServer, getFaviconIco, getIconDataUri, getIconSvg } from "./server.js";

/** Origin values permitted for HTTP requests (DNS rebinding protection). */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "") return true; // same-origin or non-browser
  const allowed = [
    "http://localhost",
    `http://localhost:${config.port}`,
    "http://127.0.0.1",
    `http://127.0.0.1:${config.port}`,
    "http://[::1]",
    `http://[::1]:${config.port}`,
  ];
  return allowed.includes(origin);
}

async function startStdio(): Promise<void> {
  const server = await createServer(getIconDataUri());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(): Promise<void> {
  // Streamable HTTP sessions: key = mcp-session-id header value.
  // Each client gets one transport instance that persists across requests.
  const mcpSessions = new Map<string, StreamableHTTPServerTransport>();

  // Each SSE client connection gets its own transport instance.
  // Map key = sessionId query param sent by the client on /messages requests.
  const sseSessions = new Map<string, SSEServerTransport>();

  // Icon URL advertised in the MCP server info so clients can display it.
  const iconUrl = `http://${config.host}:${config.port}/icon.svg`;
  const iconSvg = getIconSvg();
  const faviconIco = getFaviconIco();

  // Create the MCP server eagerly so that startBackgroundIndex() runs immediately
  // at HTTP-server startup. Without this, the tray would show "warming up…"
  // indefinitely until the first MCP request triggered createServer().
  // The instance is consumed by the first /mcp or /sse session; subsequent
  // sessions each get a fresh server (each session is independent).
  let defaultServer: McpServer | null = await createServer(iconUrl);

  const httpServer = http.createServer(
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const origin = req.headers.origin;

      // --- DNS rebinding protection -------------------------------------------
      if (!isAllowedOrigin(origin)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden: origin not allowed");
        return;
      }

      // CORS headers for browser-based clients
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      // --- Liveness probe ------------------------------------------------------
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
        return;
      }

      // --- Icon ----------------------------------------------------------------
      if (req.method === "GET" && url.pathname === "/icon.svg") {
        if (iconSvg) {
          res.writeHead(200, {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400",
          });
          res.end(iconSvg);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        }
        return;
      }

      // --- Favicon -------------------------------------------------------------
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        if (faviconIco) {
          res.writeHead(200, {
            "Content-Type": "image/x-icon",
            "Cache-Control": "public, max-age=86400",
          });
          res.end(faviconIco);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        }
        return;
      }

      // --- Streamable HTTP (modern MCP transport) ------------------------------
      if (req.method === "POST" && url.pathname === "/mcp") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

        if (!transport) {
          if (sessionId) {
            // A session ID was presented but not found — the server was restarted
            // and the session is gone. Return 404 so the client knows to
            // re-initialize (send a fresh `initialize` request without a session ID).
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32001,
                  message: "Session not found — server was restarted. Please reinitialize.",
                },
                id: null,
              })
            );
            return;
          }
          // No session ID — new session. Create a server + transport and store it.
          // Reuse the eagerly-created defaultServer for the very first session so
          // the background index that has already been warming up is not wasted.
          const server = defaultServer ?? (await createServer(iconUrl));
          defaultServer = null; // consumed — future sessions each get a fresh instance
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
          });
          await server.connect(transport);
          await transport.handleRequest(req, res);
          const newSessionId = transport.sessionId;
          if (newSessionId) {
            mcpSessions.set(newSessionId, transport);
            transport.onclose = () => mcpSessions.delete(newSessionId);
          }
        } else {
          // Existing session — reuse the transport.
          await transport.handleRequest(req, res);
        }
        return;
      }

      // --- SSE transport (legacy MCP, backward-compatible fallback) ------------
      if (req.method === "GET" && url.pathname === "/sse") {
        const server = defaultServer ?? (await createServer(iconUrl));
        defaultServer = null; // consumed
        const transport = new SSEServerTransport("/messages", res);
        sseSessions.set(transport.sessionId, transport);

        res.on("close", () => {
          sseSessions.delete(transport.sessionId);
        });

        await server.connect(transport);
        return;
      }

      if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const transport = sseSessions.get(sessionId);

        if (!transport) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end(`No active SSE session with id: ${sessionId}`);
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      // --- Catch-all -----------------------------------------------------------
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, config.host, resolve);
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        process.stderr.write(
          `\nERROR: Port ${config.port} is already in use.\n` +
            `  Another instance of obsidian-vaultgate-mcp may already be running.\n` +
            `  Change the port: OBSIDIAN_MCP_PORT=3002 obsidian-vaultgate-mcp\n\n`
        );
        process.exit(1);
      }
      reject(err);
    });
  });

  process.stdout.write(
    `✓ obsidian-vaultgate-mcp running at http://${config.host}:${config.port}\n` +
      `  Streamable HTTP: POST http://${config.host}:${config.port}/mcp\n` +
      `  SSE (legacy):    GET  http://${config.host}:${config.port}/sse\n` +
      `  Health:          GET  http://${config.host}:${config.port}/health\n`
  );

  // ---------------------------------------------------------------------------
  // Live config updates from the tray app (vault change without restart)
  // ---------------------------------------------------------------------------
  // When the user switches vault in Preferences, the tray sends a
  // __vaultgate_config__ message instead of restarting the server, preserving
  // the active MCP session. We update config.vault in place and reset the
  // semantic index so it re-embeds the new vault.
  const parentPort = (
    process as unknown as {
      parentPort?: { on: (event: string, listener: (msg: unknown) => void) => void };
    }
  ).parentPort;
  if (parentPort) {
    parentPort.on("message", (msg: unknown) => {
      if (msg && typeof msg === "object" && "__vaultgate_config__" in msg) {
        const patch = (msg as { __vaultgate_config__: { vault?: string } }).__vaultgate_config__;
        if (patch.vault !== undefined) {
          setVault(patch.vault || undefined);
          // Reset the semantic index so it rebuilds for the new vault.
          // Dynamic import avoids loading the heavy ML stack at startup when
          // @xenova/transformers may not be installed.
          import("./tools/semantic.js")
            .then(({ resetIndexForVaultChange }) => resetIndexForVaultChange())
            .catch(() => {
              // Semantic tools not available — nothing to reset.
            });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  // SIGTERM is sent by the VaultGate tray app (Phase 0 of the tray plan) and by
  // launchd/systemd on stop. SIGINT is Ctrl-C in interactive terminals.
  // Both close the HTTP listener so in-flight connections drain cleanly. A 5s
  // safety timer force-exits if a connection refuses to close — `unref()` so it
  // does not keep the event loop alive on its own.
  const shutdown = (): void => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
await runHealthCheck();

// Detect run mode:
//   OBSIDIAN_MCP_TRANSPORT=http  → always HTTP (use for launchd / background services)
//   OBSIDIAN_MCP_TRANSPORT=stdio → always stdio
//   otherwise: piped stdin (isTTY falsy) = stdio; TTY = HTTP
const transportEnv = process.env.OBSIDIAN_MCP_TRANSPORT;
if (transportEnv === "http" || (transportEnv !== "stdio" && process.stdin.isTTY)) {
  await startHttp();
} else {
  await startStdio();
}
