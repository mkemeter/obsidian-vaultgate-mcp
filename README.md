# obsidian-mcp-http

> Connect your Obsidian vault to any AI assistant — zero extra plugins, full privacy.

[![npm version](https://img.shields.io/npm/v/obsidian-mcp-http)](https://www.npmjs.com/package/obsidian-mcp-http)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#)

`obsidian-mcp-http` is a local MCP server that bridges any AI assistant directly to your Obsidian vault using the **official Obsidian CLI** — no community plugins, no REST API plugin, no network exposure. Your notes never leave your machine.

It exposes **28 purpose-built tools** — search, read, create, append, prepend, update, tasks, templates, tags, properties, and more — each with a focused schema so the AI knows exactly what's available and what each parameter does. Install `@xenova/transformers` to unlock 4 additional semantic search tools powered by a local ONNX model. Write operations default to `dryRun: true`: the assistant must show you a preview and get your explicit go-ahead before any note is modified.

It supports both **stdio transport** (for assistants like Claude Code that manage the process) and **HTTP transport** (for URL-based MCP clients such as desktop AI apps).

---

## Quick Start (3 steps)

### 1. Enable the CLI in Obsidian

Open Obsidian → **Settings → General → Command line interface → Register CLI**

This registers the `obsidian` binary on your system PATH. No Catalyst license required.

### 2. Install

```bash
npm install -g obsidian-mcp-http
```

### 3. Connect your assistant

**HTTP clients** → start the server and point your client at `http://localhost:3001` (see below).

**Claude Code** → add to `~/.claude/settings.json` (see below).

---

## HTTP clients

Start the server:

```bash
# With a specific vault (recommended if you have multiple vaults):
OBSIDIAN_VAULT="My Vault" obsidian-mcp-http

# Without vault name (uses last focused vault):
obsidian-mcp-http
```

You should see:
```
✓ obsidian-mcp-http running at http://127.0.0.1:3001
  Streamable HTTP: POST http://127.0.0.1:3001/mcp
  SSE (legacy):    GET  http://127.0.0.1:3001/sse
  Health:          GET  http://127.0.0.1:3001/health
```

Point your MCP client at `http://localhost:3001`. The server supports both the modern Streamable HTTP transport (`POST /mcp`) and the legacy SSE transport (`GET /sse`) for maximum compatibility.

---

## Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "obsidian-mcp-http",
      "env": {
        "OBSIDIAN_VAULT": "My Vault"
      }
    }
  }
}
```

Claude Code manages the process lifecycle. No separate server startup needed.

---

## Auto-start at login

### macOS

```bash
# Auto-fills absolute paths and installs the launchd agent:
cd $(npm root -g)/obsidian-mcp-http
./launchd/install.sh
```

> **Side effect:** The startup health check auto-starts Obsidian if it isn't running. With launchd enabled, **Obsidian will open automatically at login**. This is intentional — documented clearly in [launchd/README.md](launchd/README.md).

To uninstall:
```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
rm ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
```

### Windows

Use **Task Scheduler** to run `obsidian-mcp-http` at login:

1. Open Task Scheduler → **Create Basic Task**
2. Trigger: **When I log on**
3. Action: **Start a program**
   - Program: path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`)
   - Arguments: path to the `obsidian-mcp-http` script (find it with `npm root -g`)
   - Add environment variables via the task's **Environment Variables** setting:
     `OBSIDIAN_VAULT=My Vault`
     `OBSIDIAN_CLI_PATH=C:\Users\<you>\AppData\Local\Obsidian\Obsidian.exe`

Alternatively, use [NSSM](https://nssm.cc/) or [WinSW](https://github.com/winsw/winsw) to run it as a Windows service.

### Linux

Use **systemd** (user service):

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/obsidian-mcp-http.service << 'EOF'
[Unit]
Description=obsidian-mcp-http MCP server

[Service]
ExecStart=/usr/bin/node /usr/lib/node_modules/obsidian-mcp-http/build/index.js
Environment=OBSIDIAN_VAULT=My Vault
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now obsidian-mcp-http
```

Adjust `ExecStart` paths to match your Node.js and npm global install locations (`which node`, `npm root -g`).

---

## All Tools

The tools are split into focused groups so the AI can discover the right one without searching through a monolithic list. Each tool has a narrow schema — the assistant gets precise type information, required vs optional parameters, and inline documentation, which reduces hallucinated arguments and unnecessary round-trips.

### Read-only tools (safe to call without confirmation)

| Tool | What it does | Key parameters |
|------|-------------|----------------|
| `files_list` | List all files in the vault | `sort`, `limit` |
| `files_read` | Read a note's content | `file`, `path` |
| `search` | Full-text search across the vault | `query` (required), `limit` |
| `daily_read` | Read today's daily note | — |
| `tasks_all` | All tasks (checked + unchecked) | `file` |
| `tasks_pending` | Unchecked tasks only | — |
| `tasks_daily` | Today's unchecked tasks | — |
| `templates_list` | List available templates | — |
| `property_read` | Read frontmatter properties | `file` |
| `tags` | List all tags in the vault | `sort`, `counts` |
| `backlinks` | Find notes linking to a file | `file` (required) |
| `unresolved` | List unresolved wiki links | — |
| `plugins_list` | List installed plugins | — |
| `dev_errors` | Obsidian console errors | — |
| `dev_console` | Obsidian console messages | `level` |
| `dev_css` | Inspect computed CSS | `selector`, `prop` |
| `dev_dom` | Inspect DOM structure | `selector` |
| `semantic_search` | Semantic / meaning-based search | `query` (required), `top_n`, `min_score` |
| `find_similar` | Find notes similar to a given note | `note_path` (required), `top_n`, `min_score` |
| `vault_info` | Indexed note count + last update time | — |

### Maintenance tools

| Tool | What it does | Key parameters |
|------|-------------|----------------|
| `index_vault` | Force a full re-index of the vault | — |

> **Semantic tools** require the optional `@xenova/transformers` dependency (installed automatically). The first run downloads a small ONNX embedding model (~100 MB) once, silently, to `~/.cache/huggingface/`. The index is built in the background at startup and maintained automatically — no configuration needed.

### Destructive tools (require `dryRun: false`)

All write operations **default to `dryRun: true`** — they show a preview without making changes. Set `dryRun: false` for actual execution.

| Tool | What it does | Key parameters |
|------|-------------|----------------|
| `note_create` | Create a new note | `name` (required), `content`, `template`, `overwrite` |
| `note_append` | Append content to a note | `content` (required), `file`, `path` |
| `note_prepend` | Prepend content to a note (reverse-chron logs) | `content` (required), `file`, `path` |
| `note_update` | Replace full content of an existing note | `path` (required, exact vault path), `content` (required) |
| `daily_append` | Append to today's daily note | `content` (required) |
| `templates_apply` | Apply a template to a note | `template` (required), `file` |
| `property_set` | Set a frontmatter property | `name`, `value` (both required), `file` |
| `plugin_reload` | Reload an Obsidian plugin | `id` (required) |
| `dev_screenshot` | Save a screenshot of Obsidian | `path` (required) |
| `dev_mobile` | Toggle mobile emulation | `on` (required, boolean) |
| `eval` ⚠️ | Execute JavaScript in Obsidian | `code` (required) |

> **`eval` warning:** Executes arbitrary JavaScript inside Obsidian. Always confirm the dry-run preview before approving `dryRun: false`. The tool description explicitly instructs AI assistants never to run it autonomously.

---

## Configuration

All configuration is via environment variables — no hardcoded personal details.

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT` | _(last focused vault)_ | Vault name to target. Omit if you have a single vault. |
| `OBSIDIAN_CLI_PATH` | `obsidian` | Absolute path to the `obsidian` binary. Needed when the binary is not on PATH — common under launchd (macOS), Task Scheduler (Windows), or systemd (Linux). |
| `OBSIDIAN_MCP_PORT` | `3001` | HTTP port. Change if 3001 is occupied. |

Copy `.env.example` for reference:

```bash
# macOS / Linux
cp $(npm root -g)/obsidian-mcp-http/.env.example .env

# Windows (PowerShell)
Copy-Item "$(npm root -g)\obsidian-mcp-http\.env.example" .env
```

---

## Security Model

- **Localhost-only binding:** The HTTP server binds exclusively to `127.0.0.1`. It is never accessible from other machines on your network.
- **DNS rebinding protection:** Every HTTP request is validated against an allowlist of localhost `Origin` headers. Requests from any other origin receive `403 Forbidden`.
- **`dryRun: true` default:** All write operations default to preview mode. Actual execution requires explicit `dryRun: false` per call.
- **No authentication required:** Localhost-only binding makes token auth unnecessary. The server trusts the local user only.
- **`execFile` over `exec`:** The CLI is invoked via `execFile` (never `exec`), so note names and content with shell metacharacters are never interpreted by a shell.
- **No data transmitted externally:** Note content is only passed to the local `obsidian` process. Nothing leaves the machine.

---

## Requirements

- **Obsidian** v1.12.4 or later (CLI is GA and free — no Catalyst license needed)
- **Node.js** 18 or later
- **macOS, Windows, or Linux** (wherever Obsidian and Node.js run)

---

## Contributing

Contributions are welcome!

```bash
# Clone and install dependencies
git clone https://github.com/mkemeter/obsidian-mcp-http.git
cd obsidian-mcp-http
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build
npm run build
```

Please ensure `npm test` passes with no coverage regressions before opening a PR.

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, how to add a tool, and the full PR checklist.

---

## License

GPL v3 or later — see [LICENSE](LICENSE).
