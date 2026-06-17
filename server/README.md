# Obsidian VaultGate MCP

> Your Obsidian vault, accessible to any AI assistant — locally, privately, with no plugins.

[![npm version](https://img.shields.io/npm/v/obsidian-vaultgate-mcp)](https://www.npmjs.com/package/obsidian-vaultgate-mcp)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml)

VaultGate is a local [Model Context Protocol](https://modelcontextprotocol.io) server that bridges any MCP-compatible AI client with your Obsidian vault. It's built on Obsidian's native integration APIs — no community plugins, no cloud relay, no API keys.

Ask your AI to read notes, run full-text or semantic search, manage tasks, apply templates, write content, and open anything directly in the Obsidian UI. Every write goes through a dry-run preview first, so you stay in control of what actually changes.

---

🔒 **Private by design** — Note content never leaves your machine. Binds to `127.0.0.1` only.

🔐 **Obsidian stays in control** — The AI never accesses your files directly. Every operation is mediated by the running Obsidian instance, preserving its link graph, context, and integrity.

🔌 **No plugins required** — Relies entirely on Obsidian's built-in integration APIs. Zero community plugins, no extra installs.

🤖 **Works with any MCP client** — Claude, Cursor, Windsurf, Zed, and anything else that speaks MCP.

🔍 **Semantic search** — Query your vault by meaning, not just keywords — fully offline.

✋ **Explicit write consent** — Every change requires a two-step preview + confirm. Nothing is modified silently.

🪟 **GUI navigation** — Open any note, search result, or daily note directly in Obsidian. The AI can hand work off to you in the UI.

📋 **Vault conventions** — Document your folder structure and naming rules in `VAULTGATE.md` — injected into every AI session automatically.

---

## What it looks like

The **tray companion app** sits in your macOS menu bar as a small keyhole icon.
Right-click to see server status, copy the MCP connection URL, and monitor semantic
index progress in real time. The preferences window lets you switch vaults, change
the port, and locate the Obsidian binary — no config files to edit manually.

> _Screenshot — to be added after first public tray release._

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
  └──────┬──────────────┬───────┘
         │              │
  CLI · IPC socket      │  obsidian:// URI · OS launcher
         │              │
         └──────┬───────┘
                ▼
  ┌─────────────────────────────┐
  │         Obsidian App        │
  └─────────────┬───────────────┘
                │  read / write
                ▼
  ┌─────────────────────────────┐
  │         Your Vault          │  ← stays on your machine
  └─────────────────────────────┘
```

---


## Contents

- [Requirements](#requirements)
- [Installation paths](#installation-paths)
- [Setup](#setup)
  - [1. Register the Obsidian CLI](#1-register-the-obsidian-cli)
  - [2. Install](#2-install)
  - [3. Create vault conventions](#3-optional-create-vault-conventions)
  - [4. Connect your AI client](#4-connect-your-ai-client)
- [HTTP clients](#http-clients)
- [Claude Code](#claude-code)
- [Auto-start at login](#auto-start-at-login)
- [Uninstall](#uninstall)
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


## Installation paths

VaultGate ships in two flavours that share the same MCP server core. Pick whichever fits your setup; you don't need both.

| | Headless npm package (this README) | Tray companion app |
|---|---|---|
| **Best for** | Headless servers, Claude Code via stdio, Linux, scripted setups | Day-to-day use with a menu-bar / system-tray UI |
| **Install** | `npm install -g obsidian-vaultgate-mcp` | DMG (macOS arm64) or NSIS installer (Windows x64) |
| **Autostart** | Manual via launchd / systemd / Task Scheduler (`deploy/`) | Toggle in the tray menu |
| **Smart Search model** | Downloaded on first use | Pre-bundled, fully offline |
| **Linux** | ✅ supported (`deploy/systemd/`) | ❌ not supported |
| **Docs** | This README | [../tray/README.md](../tray/README.md) |

The rest of this document covers the **headless npm path**. For the tray companion, see [../tray/README.md](../tray/README.md).

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
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

Installs a `launchd` agent under `~/Library/LaunchAgents/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, Homebrew, system Node).

To uninstall: see [Uninstall](#uninstall) below.

### Linux (systemd user service)

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

Installs a systemd user service under `~/.config/systemd/user/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, volta, system Node).

To uninstall: see [Uninstall](#uninstall) below.

### Windows (Task Scheduler)

```powershell
powershell -ExecutionPolicy Bypass -File "$(npm root -g)\obsidian-vaultgate-mcp\deploy\install.ps1"
```

Detects paths automatically, prompts for your vault name, writes a startup wrapper, and registers a Task Scheduler task that runs VaultGate at login.

To uninstall: see [Uninstall](#uninstall) below.

---


## Uninstall

### macOS and Linux

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/uninstall.sh"
```

Stops the background service (if installed), removes the npm package, and deletes the local embedding cache.

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File "$(npm root -g)\obsidian-vaultgate-mcp\deploy\uninstall.ps1"
```

### What gets removed

| Item | Removed automatically |
|------|-----------------------|
| launchd agent (macOS) | ✓ if installed |
| systemd service (Linux) | ✓ if installed |
| Task Scheduler task + wrapper (Windows) | ✓ if installed |
| npm package + binary | ✓ always |
| Embedding cache (`~/.cache/obsidian-vaultgate-mcp/`) | ✓ always |
| ONNX model cache (`~/.cache/huggingface/`) | No — may be shared with other tools |
| `VAULTGATE.md` in your vault | No — your file, delete manually if wanted |

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

### GUI navigation

These tools dispatch `obsidian://` URIs through the OS to trigger navigation inside the running Obsidian instance. They bring Obsidian to the foreground — no vault data is read or written.

| Tool | Description |
|---|---|
| `note_open` | Open a note in the Obsidian GUI. Accepts `path` (vault-root) or `file` (wikilink name); optional `heading` or `block` to scroll to a location |
| `search_open` | Open the Obsidian search panel with a pre-filled query |
| `daily_open` | Open today's daily note in the Obsidian GUI |

### Read-only

| Tool | Description |
|---|---|
| `files_list` | List all notes in the vault |
| `files_read` | Read the full content of a note |
| `search` | Full-text search across the vault |
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

When `@xenova/transformers` is available (installed as an optional dependency), five additional tools are registered automatically:

- `semantic_search` — query by meaning, returns ranked results with relevance scores and the matched section heading
- `find_similar` — find notes similar to a given path
- `vault_info` — index state and note count
- `index_vault` — re-embed changed notes without discarding the existing cache (routine re-index)
- `clear_index` — delete the cache file entirely and rebuild from scratch; use only when the cache is corrupted or after a version change. **Do not use before `index_vault`** — `index_vault` already handles incremental updates without data loss.

The embedding model (`bge-small-en-v1.5`, ~100 MB) downloads once to `~/.cache/huggingface/`. All subsequent operations are fully offline. If `@xenova/transformers` fails to load on the current platform, VaultGate starts normally with the base tool set — no configuration change required.

> **Security note:** The `@xenova/transformers` package depends on `onnxruntime-web`, which in turn depends on `protobufjs` v6.x. The v6.x branch of protobufjs has [known vulnerabilities](https://github.com/protobufjs/protobuf.js/security/advisories). Your vault content is never sent to the network — the only external traffic is the one-time model download from HuggingFace. The risk is limited to the model download path and is inherited from the supply chain; it cannot be patched from this package until upstream updates.

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
This no longer happens. The startup health check only verifies the CLI binary exists on disk — it does not execute Obsidian. If Obsidian is opening at login for you, check your Login Items in System Settings.

**`note_open` / `search_open` / `daily_open` brings Obsidian to the foreground**
This is intentional — these tools are designed to hand work off to you in the UI.

**`xdg-open: command not found` (Linux)**
Install `xdg-utils` via your package manager (e.g. `sudo apt install xdg-utils`) to enable URI dispatch.

---


## Privacy and security

- **Local execution only.** All vault operations go through the running Obsidian instance — never directly to the file system. Obsidian's internal state (links, indexes, plugin context) stays consistent.
- **Loopback-only binding.** The HTTP server listens on `127.0.0.1` and is unreachable from other hosts on the network.
- **Explicit write consent.** Every write operation requires a two-step interaction: preview followed by confirmation. No file is modified in a single tool call.
- **No credentials.** Access is scoped to the local user session — no tokens, API keys, or authentication required.
- **Open source, copyleft.** GPLv3 ensures the source stays open. Inspect exactly what runs on your machine.

---


## Contributing

See [CONTRIBUTING.md](../docs/CONTRIBUTING.md) for architecture overview, tool implementation guide, and the PR checklist.

```bash
git clone https://github.com/mkemeter/obsidian-vaultgate-mcp.git
cd obsidian-vaultgate-mcp/server
npm install
npm test
```

---


## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
