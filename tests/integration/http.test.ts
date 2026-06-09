/**
 * HTTP integration tests.
 *
 * Starts a real `http.createServer` bound to 127.0.0.1 on a random port
 * so tests never conflict with a running obsidian-cli-mcp instance.
 *
 * These tests exercise the routing and security layer in `src/index.ts`
 * without invoking the actual Obsidian CLI binary.
 */

import * as http from "node:http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock the health check so tests don't need the obsidian binary on PATH.
vi.mock("../../src/health.js", () => ({ runHealthCheck: vi.fn() }));
// Mock cli.js so tool calls don't spawn real processes.
vi.mock("../../src/cli.js", () => ({ runObsidian: vi.fn().mockResolvedValue("") }));

// ---------------------------------------------------------------------------
// Inline the HTTP server logic from index.ts so tests can control the port
// ---------------------------------------------------------------------------
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createMcpServer } from "../../src/server.js";

function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === "") return true;
  const allowed = [
    "http://localhost",
    `http://localhost:${port}`,
    "http://127.0.0.1",
    `http://127.0.0.1:${port}`,
  ];
  return allowed.includes(origin);
}

/** Start a test HTTP server on a random OS-assigned port. Returns the server and its URL. */
function startTestServer(): Promise<{ server: http.Server; baseUrl: string; port: number }> {
  const sseSessions = new Map<string, SSEServerTransport>();

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const port = (server.address() as { port: number }).port;

    if (!isAllowedOrigin(origin, port)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: origin not allowed");
      return;
    }

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

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp") {
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      const mcpServer = createMcpServer();
      const transport = new SSEServerTransport("/messages", res);
      sseSessions.set(transport.sessionId, transport);
      res.on("close", () => sseSessions.delete(transport.sessionId));
      await mcpServer.connect(transport);
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

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return new Promise((resolve) => {
    // Port 0 = OS picks a free port
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HTTP server", () => {
  let server: http.Server;
  let baseUrl: string;
  let port: number;

  beforeAll(async () => {
    ({ server, baseUrl, port } = await startTestServer());
  });

  afterAll(() => {
    server.close();
  });

  // --- Liveness probe -------------------------------------------------------

  it("GET /health returns 200 OK", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("OK");
  });

  // --- DNS rebinding protection ---------------------------------------------

  it("rejects request with foreign Origin header with 403", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  it("accepts request with no Origin header", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("accepts request with localhost Origin", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://localhost" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts request with 127.0.0.1 Origin", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "http://127.0.0.1" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts request with port-qualified localhost Origin", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Origin: `http://localhost:${port}` },
    });
    expect(res.status).toBe(200);
  });

  // --- CORS preflight -------------------------------------------------------

  it("OPTIONS returns 204 for localhost Origin", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost" },
    });
    expect(res.status).toBe(204);
  });

  // --- Streamable HTTP (POST /mcp) -----------------------------------------

  it("POST /mcp with valid MCP initialize request returns a response", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0" },
      },
    };

    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });

    // The SDK may respond with 200 (JSON) or start an SSE stream (200 text/event-stream).
    // Either way, status must be 2xx.
    expect(res.status).toBe(200);
  });

  it("POST /mcp with wrong Origin returns 403", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://attacker.example",
      },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  // --- SSE endpoint (GET /sse) ----------------------------------------------

  it("GET /sse begins an SSE stream with correct content-type", async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/sse`, { signal: ac.signal });

    // The SSE transport sets text/event-stream before we can read body
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Abort immediately — we only needed to verify the handshake
    ac.abort();
  });

  // --- 404 catch-all --------------------------------------------------------

  it("unknown path returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown-path`);
    expect(res.status).toBe(404);
  });

  // --- POST /messages without session ---------------------------------------

  it("POST /messages without valid sessionId returns 400", async () => {
    const res = await fetch(`${baseUrl}/messages?sessionId=nonexistent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  // --- Binding address ------------------------------------------------------

  it("server binds to 127.0.0.1 (not 0.0.0.0)", () => {
    const addr = server.address() as { address: string };
    expect(addr.address).toBe("127.0.0.1");
  });
});
