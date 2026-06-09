# obsidian-mcp-http

> Your Obsidian vault, accessible to any AI assistant — locally, privately, with no plugins.

[![npm version](https://img.shields.io/npm/v/obsidian-mcp-http)](https://www.npmjs.com/package/obsidian-mcp-http)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#)

`obsidian-mcp-http` is a local [Model Context Protocol](https://modelcontextprotocol.io) server that bridges any MCP-compatible AI client with your Obsidian vault. It's built on the official Obsidian CLI — no community plugins, no cloud relay, no API keys.

The AI can read your notes, search across your vault, manage tasks, apply templates, and write content on your behalf. Every write goes through a dry-run preview first, so you stay in control of what actually changes.

---

## What makes this different

**Privacy-first by design.** Note content never leaves your machine. The HTTP server binds exclusively to `127.0.0.1`.

**No plugins required.** Communication goes through the official Obsidian CLI, which is bundled with Obsidian and uses the same secure IPC channel as the Obsidian mobile sync.

**Works with every MCP client.** Supports both Streamable HTTP (modern, MCP spec 2025-03-26) and SSE legacy transport, so it connects to Claude Desktop, Cursor, Windsurf, Zed, and any other MCP-compatible tool.

**Semantic search built in.** When `@xenova/transformers` is available (installed automatically as an optional dependency), the vault is indexed in the background using `bge-small-en-v1.5` embeddings. Query by meaning, not just keywords — fully offline after the initial model download.

**Explicit write consent.** Every write operation defaults to `dryRun: true`. The AI presents a diff-style preview; the change is applied only when called again with `dryRun: false`.

---

## Requirements

- **Obsidian** v1.8.9 or later (CLI introduced in this release)
- **Node.js** v18 or later

---

## Setup

### 1. Register the Obsidian CLI

The CLI is bundled with Obsidian but must be registered once before external processes can use it.

1. Open Obsidian → **Settings → General**
2. Scroll to **Command line interface**
3. Click **Register CLI**

This writes a socket/pipe entry that `obsidian-mcp-http` uses to communicate with the running Obsidian instance. It persists across restarts — one-time setup per machine.

### 2. Install

```bash
npm install -g obsidian-mcp-http
```

### 3. Connect your AI client

- [HTTP / URL-based clients](#http-clients) — Cursor, Windsurf, Zed, and most desktop apps
- [Claude Code (stdio)](#claude-code) — direct subprocess integration

---

## HTTP clients

Start the server:

```bash
obsidian-mcp-http
```

For a specific vault:

```bash
OBSIDIAN_VAULT="My Vault" obsidian-mcp-http
```

```
✓ obsidian-mcp-http running at http://127.0.0.1:3001
  Streamable HTTP: POST http://127.0.0.1:3001/mcp
  SSE (legacy):    GET  http://127.0.0.1:3001/sse
  Health:          GET  http://127.0.0.1:3001/health
```

Add a new MCP server in your AI app:

| Transport | URL |
|-----------|-----|
| Streamable HTTP (preferred) | `http://localhost:3001/mcp` |
| SSE legacy | `http://localhost:3001/sse` |

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

Claude Code manages the process lifecycle via stdio — no separate startup needed. Omit `env` if you only have one vault.

---

## Auto-start at login

### macOS (launchd)

```bash
cd $(npm root -g)/obsidian-mcp-http
./launchd/install.sh
```

Installs a `launchd` agent under `~/Library/LaunchAgents/` that starts the server at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, Homebrew, system Node).

> Note: Obsidian is also launched at login, because the startup health check communicates with the running instance.

To uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
rm ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
```

### Linux (systemd user service)

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

Adjust `ExecStart` paths with `which node` and `npm root -g`.

### Windows (Task Scheduler)

1. **Create Basic Task** → name it `obsidian-mcp-http`
2. Trigger: **When I log on**
3. Action: **Start a program** — `node.exe` with the package entry point as argument (`npm root -g` + `\obsidian-mcp-http\build\index.js`)
4. Set `OBSIDIAN_VAULT` in environment variables if needed

---

## Configuration

All configuration via environment variables. None are required for single-vault setups on the default port.

| Variable | Default | Description |
|---|---|---|
| `OBSIDIAN_VAULT` | _(last opened vault)_ | Target vault name (directory name, not path). Required when multiple vaults are open. |
| `OBSIDIAN_MCP_PORT` | `3001` | TCP port for HTTP mode. |
| `OBSIDIAN_MCP_HOST` | `127.0.0.1` | Bind address. Do not expose to non-loopback interfaces. |
| `OBSIDIAN_MCP_TRANSPORT` | _(auto-detect)_ | `http` to force HTTP mode, `stdio` to force stdio. Auto-detected from `stdin.isTTY`. |
| `OBSIDIAN_CLI_PATH` | `obsidian` | Absolute path to the Obsidian binary. Required in service contexts where `PATH` differs from the user shell. |

---

## Available tools

### Read-only

| Tool | Description |
|---|---|
| `files_list` | List all notes in the vault |
| `files_read` | Read the full content of a note |
| `search` | Full-text search across the vault |
| `semantic_search` | Natural language search ranked by meaning (requires `@xenova/transformers`) |
| `find_similar` | Find notes semantically similar to a given path |
| `vault_info` | Indexed note count and last-indexed timestamp |
| `daily_read` | Read today's daily note |
| `tasks_all` | All tasks (complete and incomplete) |
| `tasks_pending` | Incomplete tasks only |
| `tasks_daily` | Incomplete tasks from today's daily note |
| `templates_list` | List available templates |
| `property_read` | Read YAML frontmatter properties |
| `tags` | All tags across the vault |
| `backlinks` | Notes that link to a given note |
| `unresolved` | Wikilinks pointing to non-existent notes |
| `plugins_list` | Installed community plugins |
| `dev_errors` | Recent errors from the Obsidian console |
| `dev_console` | Console log output from Obsidian |
| `dev_css` | Computed CSS for a DOM selector |
| `dev_dom` | DOM subtree of the Obsidian window |

### Write (dry-run by default)

Every write tool defaults to `dryRun: true` — the AI shows a preview of the intended change and waits for explicit confirmation before touching any file.

| Tool | Description |
|---|---|
| `note_create` | Create a new note |
| `note_append` | Append content to an existing note |
| `note_prepend` | Prepend content to an existing note |
| `note_update` | Replace the full content of an existing note |
| `daily_append` | Append content to today's daily note |
| `templates_apply` | Apply a template to a note |
| `property_set` | Set or update a YAML frontmatter property |
| `plugin_reload` | Reload a community plugin by ID |
| `dev_screenshot` | Capture a screenshot of the Obsidian window |
| `dev_mobile` | Toggle mobile viewport emulation |
| `eval` ⚠️ | Execute arbitrary JavaScript in the Obsidian renderer — review carefully before approving |

### Semantic search

When `@xenova/transformers` is available (installed as an optional dependency), four additional tools are registered automatically:

- `semantic_search` — query by meaning, returns ranked results with relevance scores
- `find_similar` — find notes similar to a given path
- `vault_info` — index state and note count
- `index_vault` — force a full re-index (normally not needed; the index updates incrementally on each search)

The embedding model (`bge-small-en-v1.5`, ~100 MB) downloads once to `~/.cache/huggingface/`. All subsequent operations are fully offline. If `@xenova/transformers` fails to load on the current platform, the server starts normally with the base tool set — no configuration change required.

---

## Troubleshooting

**`command not found: obsidian-mcp-http`**
The npm global bin directory is not on `PATH`. Run `npm bin -g` to find it, then add to your shell profile. Or invoke via `npx obsidian-mcp-http`.

**`command not found: obsidian` (the CLI binary)**
The CLI has not been registered. Go to [Step 1](#1-register-the-obsidian-cli) and click **Register CLI** in Obsidian settings.

**Server starts but the AI client reports no tools**
The client has a stale session. Disconnect and reconnect to trigger a fresh `initialize` handshake.

**`semantic_search` returns "still indexing"**
The embedding index is built asynchronously at startup. For large vaults this can take a few minutes. `vault_info` shows the current index state.

**Port already in use**
Set `OBSIDIAN_MCP_PORT=3002` and update the URL in your AI client.

**Obsidian launches at login**
Side effect of the launchd agent — the startup health check communicates with the running Obsidian instance. See [macOS uninstall steps](#macos-launchd) to remove the agent.

---

## Privacy and security

- **Local execution only.** All vault operations run through the local `obsidian` process. No note content is transmitted to any external service by this package.
- **Loopback-only binding.** The HTTP server listens on `127.0.0.1` and is unreachable from other hosts on the network.
- **Explicit write consent.** Every write operation requires a two-step interaction: preview followed by confirmation. No file is modified in a single tool call.
- **No credentials.** Access is scoped to the local user session — no tokens, API keys, or authentication required.
- **Open source, copyleft.** GPLv3 ensures the source stays open. Inspect exactly what runs on your machine.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview, tool implementation guide, and the PR checklist.

```bash
git clone https://github.com/mkemeter/obsidian-mcp-http.git
cd obsidian-mcp-http
npm install
npm test
```

---

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
