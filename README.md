# Obsidian VaultGate MCP

> Your Obsidian vault, accessible to any AI assistant — locally, privately, with no plugins.

[![npm version](https://img.shields.io/npm/v/obsidian-vaultgate-mcp)](https://www.npmjs.com/package/obsidian-vaultgate-mcp)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#)

VaultGate is a local [Model Context Protocol](https://modelcontextprotocol.io) server that bridges any MCP-compatible AI client with your Obsidian vault. It's built on the official Obsidian CLI — no community plugins, no cloud relay, no API keys.

Ask your AI to read notes, run full-text or semantic search, manage tasks, apply templates, and write content on your behalf. Every write goes through a dry-run preview first, so you stay in control of what actually changes.

---

🔒 **Private by design** — Note content never leaves your machine. Binds to `127.0.0.1` only.

🔌 **No plugins required** — Uses the official Obsidian CLI — bundled with Obsidian, zero community plugins.

🤖 **Works with any MCP client** — Claude, Cursor, Windsurf, Zed, and anything else that speaks MCP.

🔍 **Semantic search** — Query your vault by meaning, not just keywords — fully offline.

✋ **Explicit write consent** — Every change requires a two-step preview + confirm. Nothing is modified silently.

📋 **Vault conventions** — Document your folder structure and naming rules in `VAULTGATE.md` — injected into every AI session automatically.

---

```
  Your AI Assistant
  (Claude · Cursor · Windsurf · Zed · …)
           │
           │  Model Context Protocol  (HTTP or stdio)
           ▼
  ┌─────────────────────────────┐
  │          VaultGate          │  ← this package
  │       127.0.0.1 only        │
  └─────────────────────────────┘
           │
           │  Official Obsidian CLI  ·  local IPC
           ▼
  ┌─────────────────────────────┐
  │         Obsidian App        │
  └─────────────────────────────┘
           │
           │  read / write
           ▼
  ┌─────────────────────────────┐
  │         Your Vault          │  ← stays on your machine
  └─────────────────────────────┘
```

---


## Contents

- [Requirements](#requirements)
- [Setup](#setup)
  - [1. Register the Obsidian CLI](#1-register-the-obsidian-cli)
  - [2. Install](#2-install)
  - [3. Create vault conventions](#3-optional-create-vault-conventions)
  - [4. Connect your AI client](#4-connect-your-ai-client)
- [HTTP clients](#http-clients)
- [Claude Code](#claude-code)
- [Auto-start at login](#auto-start-at-login)
- [Configuration](#configuration)
- [Available tools](#available-tools)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [Contributing](#contributing)
- [License](#license)

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

This writes a socket/pipe entry that VaultGate uses to communicate with the running Obsidian instance. It persists across restarts — one-time setup per machine.

### 2. Install

```bash
npm install -g obsidian-vaultgate-mcp
```

To try without installing globally:

```bash
npx obsidian-vaultgate-mcp
```

### 3. (Optional) Create vault conventions

Create a file called `VAULTGATE.md` at the root of your vault to document how your vault is organised. At every new session, the contents are automatically injected into the AI assistant's system prompt — so it always knows your folder structure, naming rules, tag taxonomy, frontmatter schema, and template conventions without you having to explain them each time.

**Sample `VAULTGATE.md`:**

```markdown
# Vault Conventions


## Folder structure
- `Projects/` — one note per project, status in frontmatter
- `People/` — contacts and team members
- `Daily/` — daily notes (YYYY-MM-DD.md)
- `Resources/` — reference material


## Frontmatter
All notes should have: `status`, `tags`, `created` (ISO date).


## Tags
Prefer lowercase kebab-case. Core taxonomy: #project, #person, #resource, #meeting.


## Naming
Use sentence case for note titles. No special characters except hyphens.
```

You can also ask your AI assistant: *"Help me set up vault conventions"* — it will analyse your vault structure and draft `VAULTGATE.md` for you using the `vault_context_set` tool.

> **Note:** `VAULTGATE.md` is read at connection time. To pick up edits mid-session, ask your assistant to call `vault_context` — it always reads the current file content.

### 4. Connect your AI client

- [HTTP / URL-based clients](#http-clients) — Cursor, Windsurf, Zed, and most desktop apps
- [Claude Code (stdio)](#claude-code) — direct subprocess integration

---


## HTTP clients

Start VaultGate:

```bash
obsidian-vaultgate-mcp
```

For a specific vault:

```bash
OBSIDIAN_VAULT="My Vault" obsidian-vaultgate-mcp
```

```
✓ VaultGate running at http://127.0.0.1:3001
  Streamable HTTP: POST http://127.0.0.1:3001/mcp
  SSE (legacy):    GET  http://127.0.0.1:3001/sse
  Health:          GET  http://127.0.0.1:3001/health
```

Verify it's running:

```bash
curl http://localhost:3001/health   # should print: OK
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
      "command": "obsidian-vaultgate-mcp",
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
cd $(npm root -g)/obsidian-vaultgate-mcp
./launchd/install.sh
```

Installs a `launchd` agent under `~/Library/LaunchAgents/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, Homebrew, system Node).

> Note: Obsidian is also launched at login, because the startup health check communicates with the running instance.

To uninstall:

```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
rm ~/Library/LaunchAgents/com.obsidian-vaultgate-mcp.plist
```

### Linux (systemd user service)

```bash
cd $(npm root -g)/obsidian-vaultgate-mcp
./systemd/install.sh
```

Installs a systemd user service under `~/.config/systemd/user/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, volta, system Node).

> Note: Obsidian is also launched at login, because the startup health check communicates with the running instance.

To uninstall:

```bash
systemctl --user disable --now obsidian-vaultgate-mcp
rm ~/.config/systemd/user/obsidian-vaultgate-mcp.service
systemctl --user daemon-reload
```

### Windows (Task Scheduler)

1. **Create Basic Task** → name it `VaultGate`
2. Trigger: **When I log on**
3. Action: **Start a program** — `node.exe` with the package entry point as argument (`npm root -g` + `\obsidian-vaultgate-mcp\build\index.js`)
4. Set `OBSIDIAN_VAULT` in environment variables if needed

---


## Configuration

All configuration via environment variables. None are required for single-vault setups on the default port.

| Variable | Default | Description |
|---|---|---|
| `OBSIDIAN_VAULT` | _(last opened vault)_ | Target vault name (directory name, not path). Required when multiple vaults are open. |
| `OBSIDIAN_MCP_PORT` | `3001` | TCP port for HTTP mode. |
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
| `templates_list` | List available templates (requires core Templates plugin — see note below) |
| `property_read` | Read a specific YAML frontmatter property by name |
| `tags` | All tags across the vault |
| `backlinks` | Notes that link to a given note |
| `unresolved` | Wikilinks pointing to non-existent notes |
| `plugins_list` | Installed community plugins |
| `dev_errors` | Recent errors from the Obsidian console |
| `dev_console` | Console log output from Obsidian (requires `dev:debug on` first — run once via `eval`) |
| `dev_css` | Computed CSS for a DOM selector |
| `dev_dom` | DOM subtree of the Obsidian window |
| `vault_context` | Read vault conventions from `VAULTGATE.md` (fallback if conventions were not delivered at session start) |

### Write (dry-run by default)

Every write tool defaults to `dryRun: true` — the AI shows a preview of the intended change and waits for explicit confirmation before touching any file.

| Tool | Description |
|---|---|
| `note_create` | Create a new note (use `path=` for subfolder locations) |
| `note_append` | Append content to an existing note |
| `note_prepend` | Prepend content to an existing note |
| `note_update` | Replace the full content of an existing note |
| `note_trash` | Move a note to the system trash (recoverable) |
| `daily_append` | Append content to today's daily note |
| `templates_apply` | Apply a template to a note |
| `property_set` | Set or update a YAML frontmatter property |
| `plugin_reload` | Reload a community plugin by ID |
| `dev_screenshot` | Capture a screenshot of the Obsidian window |
| `dev_mobile` | Toggle mobile viewport emulation |
| `eval` ⚠️ | Execute arbitrary JavaScript in the Obsidian renderer — review carefully before approving |
| `vault_context_set` | Create or update `VAULTGATE.md` — the vault conventions file read by AI assistants at session start |

> **templates_list / templates_apply** require the built-in **Templates** core plugin with a folder configured in its settings. If your vault uses the **Templater** community plugin instead (or the core plugin is disabled), these tools will return `Error: No template folder configured`. This is a configuration dependency, not a bug.

### Semantic search

When `@xenova/transformers` is available (installed as an optional dependency), four additional tools are registered automatically:

- `semantic_search` — query by meaning, returns ranked results with relevance scores
- `find_similar` — find notes similar to a given path
- `vault_info` — index state and note count
- `index_vault` — force a full re-index (normally not needed; the index updates incrementally on each search)

The embedding model (`bge-small-en-v1.5`, ~100 MB) downloads once to `~/.cache/huggingface/`. All subsequent operations are fully offline. If `@xenova/transformers` fails to load on the current platform, VaultGate starts normally with the base tool set — no configuration change required.

---


## Troubleshooting

**`command not found: obsidian-vaultgate-mcp`**
The npm global bin directory is not on `PATH`. Run `npm bin -g` to find it, then add to your shell profile. Or invoke via `npx obsidian-vaultgate-mcp`.

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
git clone https://github.com/mkemeter/obsidian-vaultgate-mcp.git
cd obsidian-vaultgate-mcp
npm install
npm test
```

---


## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
