# HTTP MCP Client Setup

For URL-based MCP clients, start the server and point it at:

**URL:** `http://localhost:3001`

## Starting the server

```bash
# Replace "My Vault" with your actual vault name, or omit if you have one vault:
OBSIDIAN_VAULT="My Vault" obsidian-vaultgate-mcp
```

Expected output:
```
✓ obsidian-vaultgate-mcp running at http://127.0.0.1:3001
  Streamable HTTP: POST http://127.0.0.1:3001/mcp
  SSE (legacy):    GET  http://127.0.0.1:3001/sse
  Health:          GET  http://127.0.0.1:3001/health
```

The server supports both the modern Streamable HTTP transport (`POST /mcp`, MCP spec 2025-03-26)
and the legacy SSE transport (`GET /sse`) for backward compatibility.

## Auto-start (recommended)

For always-on availability, install the macOS launchd agent so the server
starts automatically at login:

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

## Troubleshooting

- **"Connection refused"** — the server isn't running. Start it or install the launchd agent.
- **"Port already in use"** — another process is on port 3001. Change it: `OBSIDIAN_MCP_PORT=3002 obsidian-vaultgate-mcp` and connect to `http://localhost:3002`.
- **Tools return errors** — Obsidian may not be running. The CLI auto-starts it; give it a moment and retry.
