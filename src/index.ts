#!/usr/bin/env node
/**
 * obsidian-mcp-http entry point.
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
 */

import * as http from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { runHealthCheck } from "./health.js";
import { createServer } from "./server.js";

/** Origin values permitted for HTTP requests (DNS rebinding protection). */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "") return true; // same-origin or non-browser
  const allowed = [
    "http://localhost",
    `http://localhost:${config.port}`,
    "http://127.0.0.1",
    `http://127.0.0.1:${config.port}`,
  ];
  return allowed.includes(origin);
}

async function startStdio(): Promise<void> {
  const server = createServer();
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

  const httpServer = http.createServer(async (req, res) => {
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

    // --- Streamable HTTP (modern MCP transport) ------------------------------
    if (req.method === "POST" && url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

      if (!transport) {
        // New session — create a server + transport and store it.
        const server = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        if (transport.sessionId) {
          mcpSessions.set(transport.sessionId, transport);
          transport.onclose = () => mcpSessions.delete(transport!.sessionId!);
        }
      } else {
        // Existing session — reuse the transport.
        await transport.handleRequest(req, res);
      }
      return;
    }

    // --- SSE transport (legacy MCP, backward-compatible fallback) ------------
    if (req.method === "GET" && url.pathname === "/sse") {
      const server = createServer();
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

    // --- Catch-all ------------------------------------------------------------
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, config.host, resolve);
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        process.stderr.write(
          `\nERROR: Port ${config.port} is already in use.\n` +
            `  Another instance of obsidian-mcp-http may already be running.\n` +
            `  Change the port: OBSIDIAN_MCP_PORT=3002 obsidian-mcp-http\n\n`
        );
        process.exit(1);
      }
      reject(err);
    });
  });

  process.stdout.write(
    `✓ obsidian-mcp-http running at http://${config.host}:${config.port}\n` +
      `  Streamable HTTP: POST http://${config.host}:${config.port}/mcp\n` +
      `  SSE (legacy):    GET  http://${config.host}:${config.port}/sse\n` +
      `  Health:          GET  http://${config.host}:${config.port}/health\n`
  );
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
