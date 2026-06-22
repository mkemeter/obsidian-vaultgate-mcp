<div align="center">

<img src="tray/assets/icon.svg" width="80" alt="VaultGate" />

# VaultGate

**Your Obsidian vault, accessible to any AI assistant — locally, privately, with no plugins.**

[![npm version](https://img.shields.io/npm/v/obsidian-vaultgate-mcp)](https://www.npmjs.com/package/obsidian-vaultgate-mcp)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml)

</div>

VaultGate is a local [Model Context Protocol](https://modelcontextprotocol.io) server that bridges any MCP-compatible AI client with your Obsidian vault — built on Obsidian's native integration APIs. No community plugins, no cloud relay, no API keys.

Ask your AI to read notes, run full-text or semantic search, manage tasks, apply templates, write content, and open anything directly in the Obsidian UI. Every write goes through a dry-run preview first, so you stay in control of what actually changes.

<div align="center">

[![Tray app — macOS Apple Silicon](https://img.shields.io/badge/Tray_app-macOS_Apple_Silicon-7c3aed?style=for-the-badge&logo=apple&logoColor=white)](#tray-companion-app)
&nbsp;&nbsp;
[![Headless npm package](https://img.shields.io/badge/Headless_npm_package-Linux_%7C_Windows_%7C_macOS-3b82f6?style=for-the-badge&logo=npm&logoColor=white)](#headless-npm-package)

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

**🔒 Private by design**
Note content never leaves your machine. Binds to `127.0.0.1` only — unreachable from any other host on the network.

</td>
<td width="50%">

**🤖 Any MCP client**
Claude, Cursor, Windsurf, Zed, and anything else that speaks MCP — via HTTP or stdio.

</td>
</tr>
<tr>
<td>

**🔌 No plugins required**
Built entirely on Obsidian's built-in CLI APIs. Zero community plugins, no extra installs in Obsidian.

</td>
<td>

**🔍 Offline semantic search**
Query your vault by meaning, not just keywords. Powered by `@xenova/transformers` — fully local, no network call.

</td>
</tr>
<tr>
<td>

**✋ Explicit write consent**
Every write is a two-step preview + confirm. No file is modified silently, ever.

</td>
<td>

**🪟 GUI navigation**
Open any note, search result, or daily note directly in Obsidian. The AI can hand work off to you in the UI.

</td>
</tr>
<tr>
<td>

**🔐 Obsidian stays in control**
The AI never touches your files directly. Every operation is mediated by the running Obsidian instance.

</td>
<td>

**📋 Vault conventions**
Drop a `VAULTGATE.md` at your vault root — injected into every AI session automatically so the AI always knows your structure.

</td>
</tr>
</table>

---

## Contents

- [Getting Started](#-getting-started)
- [Headless npm Package](#headless-npm-package)
  - [Install](#install)
  - [Connect your AI client](#connect-your-ai-client)
  - [Auto-start at login](#auto-start-at-login)
  - [Uninstall](#uninstall)
  - [Configuration](#configuration)
  - [Available tools](#available-tools)
  - [Troubleshooting](#troubleshooting)
- [Tray Companion App](#tray-companion-app)
  - [Platforms](#platforms)
  - [Install](#install-1)
  - [First run](#first-run)
  - [Connect an AI client](#connect-an-ai-client)
  - [Preferences](#preferences)
  - [Smart Search](#smart-search)
  - [Logs](#logs)
  - [Quitting and uninstalling](#quitting-and-uninstalling)
- [Privacy and Security](#privacy-and-security)
- [Repository Layout](#repository-layout)
- [Contributing](#contributing)

---

## 🚀 Getting Started

VaultGate ships in two distributions that share the same MCP server core. Pick one — you don't need both.

| | 📦 Headless npm package | 🖥️ Tray companion app |
|---|---|---|
| **Best for** | Claude Code, headless servers, Linux, scripting | Day-to-day use on macOS with a GUI |
| **Install** | `npm install -g obsidian-vaultgate-mcp` | DMG drag-and-drop |
| **UI** | None — CLI / daemon | Menu bar icon |
| **Autostart** | launchd / systemd / Task Scheduler | Toggle in tray menu |
| **Smart Search model** | Downloaded on first use | Pre-bundled, fully offline |
| **macOS** | ✅ | ✅ Apple Silicon only |
| **Windows** | ✅ | ❌ |
| **Linux** | ✅ | ❌ |
| **Bundle size** | ~6 MB + lazy model | ~200 MB DMG |

> [!NOTE]
> Requires **Obsidian 1.8.9 or later** on all paths. The npm package additionally requires **Node.js 18+**.

### Before you start

These two steps apply to both distributions.

#### 1. Register the Obsidian CLI

The CLI is bundled with Obsidian but must be registered once before external processes can use it.

1. Open Obsidian → **Settings → General**
2. Scroll to **Command line interface**
3. Click **Register CLI**

This writes a socket/pipe entry that VaultGate uses to communicate with the running Obsidian instance. It persists across restarts — one-time setup per machine.

#### 2. (Optional) Create vault conventions

Create a file called `VAULTGATE.md` at the root of your vault to document how your vault is organised. Its contents are automatically injected into the AI assistant's system prompt at every new session — so it always knows your folder structure, naming rules, tag taxonomy, frontmatter schema, and template conventions without you having to explain them each time.

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

> [!NOTE]
> `VAULTGATE.md` is read at connection time. To pick up edits mid-session, ask your assistant to call `vault_context` — it always reads the current file content.

---

## 💬 What can you ask?

Once VaultGate is connected, talk to your vault naturally. A few examples across the main capabilities:

**Finding & retrieving notes**
> *"What did I write about the Q3 planning session?"*
> *"Find all notes tagged #meeting and list their titles."*

**Reading a note**
> *"Read my note called 'Architecture decisions'."*

**Creating & editing**
> *"Create a meeting note for today called 'Kickoff with Anna' using the Meeting template."*
> *"Append a summary of this conversation to my 'Project ideas' note."*

**Daily notes & tasks**
> *"What tasks are still open in today's daily note?"*
> *"Add an action item to today's note: follow up with the team by Friday."*

**Vault-wide task overview**
> *"Show me all pending tasks across my vault."*

**Discovery & linking**
> *"Which notes link to my 'Team structure' note?"*
> *"Find notes similar to my 'Onboarding plan'."* *(requires Smart Search)*

**Handing off to the Obsidian UI**
> *"Open today's daily note."*
> *"Open my 'Architecture decisions' note and scroll to the Risks section."*

For the full list of capabilities, see [Available tools](#available-tools).

---

## Headless npm Package

The reference distribution — runs on macOS, Linux, and Windows with no GUI. Ideal for [Claude Code](#claude-code) stdio integration, headless servers, and scripted setups.

### Install

```bash
npm install -g obsidian-vaultgate-mcp
```

To try without installing globally:

```bash
npx obsidian-vaultgate-mcp
```

### Connect your AI client

#### HTTP clients

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

#### Claude Code

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

### Auto-start at login

#### macOS (launchd)

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

Installs a `launchd` agent under `~/Library/LaunchAgents/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, Homebrew, system Node).

#### Linux (systemd user service)

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/install.sh"
```

Installs a systemd user service under `~/.config/systemd/user/` that starts VaultGate at login and restarts it on failure. The install script resolves all paths automatically (compatible with nvm, volta, system Node).

#### Windows (Task Scheduler)

```powershell
powershell -ExecutionPolicy Bypass -File "$(npm root -g)\obsidian-vaultgate-mcp\deploy\install.ps1"
```

Detects paths automatically, prompts for your vault name, writes a startup wrapper, and registers a Task Scheduler task that runs VaultGate at login.

### Uninstall

#### macOS and Linux

```bash
bash "$(npm root -g)/obsidian-vaultgate-mcp/deploy/uninstall.sh"
```

Stops the background service (if installed), removes the npm package, and deletes the local embedding cache.

#### Windows

```powershell
powershell -ExecutionPolicy Bypass -File "$(npm root -g)\obsidian-vaultgate-mcp\deploy\uninstall.ps1"
```

#### What gets removed

| Item | Removed automatically |
|------|-----------------------|
| launchd agent (macOS) | ✓ if installed |
| systemd service (Linux) | ✓ if installed |
| Task Scheduler task + wrapper (Windows) | ✓ if installed |
| npm package + binary | ✓ always |
| Embedding cache (`~/.cache/obsidian-vaultgate-mcp/`) | ✓ always |
| ONNX model cache (`~/.cache/huggingface/`) | No — may be shared with other tools |
| `VAULTGATE.md` in your vault | No — your file, delete manually if wanted |

### Configuration

All configuration via environment variables. None are required for single-vault setups on the default port.

| Variable | Default | Description |
|---|---|---|
| `OBSIDIAN_VAULT` | _(last opened vault)_ | Target vault name (directory name, not path). Required when multiple vaults are open. |
| `OBSIDIAN_MCP_PORT` | `3001` | TCP port for HTTP mode. |
| `OBSIDIAN_MCP_TRANSPORT` | _(auto-detect)_ | `http` to force HTTP mode, `stdio` to force stdio. Auto-detected from `stdin.isTTY`. |
| `OBSIDIAN_CLI_PATH` | `obsidian` | Absolute path to the Obsidian binary. Required in service contexts where `PATH` differs from the user shell. |

### Available tools

VaultGate exposes 34 base tools across four categories, plus 5 semantic search tools when the embedding model is available. These tools are the concrete implementation of the features described above — and they are identical across both the headless and tray distributions.

#### GUI navigation

Dispatch `obsidian://` URIs through the OS to trigger navigation inside the running Obsidian instance. Bring Obsidian to the foreground — no vault data is read or written.

| Tool | Description |
|---|---|
| `note_open` | Open a note in the Obsidian GUI. Accepts `path` (vault-root) or `file` (wikilink name); optional `heading` or `block` to scroll to a location |
| `search_open` | Open the Obsidian search panel with a pre-filled query |
| `daily_open` | Open today's daily note in the Obsidian GUI |

#### Read-only

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

#### Write (dry-run by default)

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

> [!NOTE]
> **templates_list / templates_apply** require the built-in **Templates** core plugin with a folder configured in its settings. If your vault uses the **Templater** community plugin instead (or the core plugin is disabled), these tools will return `Error: No template folder configured`. This is a configuration dependency, not a bug.

#### Semantic search

When `@xenova/transformers` is available (installed as an optional dependency), five additional tools are registered automatically:

- `semantic_search` — query by meaning, returns ranked results with relevance scores and the matched section heading
- `find_similar` — find notes similar to a given path
- `vault_info` — index state and note count
- `index_vault` — re-embed changed notes without discarding the existing cache (routine re-index)
- `clear_index` — delete the cache file entirely and rebuild from scratch; use only when the cache is corrupted or after a version change. **Do not use before `index_vault`** — `index_vault` already handles incremental updates without data loss.

The embedding model (`bge-small-en-v1.5`, ~100 MB) downloads once to `~/.cache/huggingface/`. All subsequent operations are fully offline. If `@xenova/transformers` fails to load on the current platform, VaultGate starts normally with the base tool set — no configuration change required.

> [!WARNING]
> The `@xenova/transformers` package depends on `onnxruntime-web`, which in turn depends on `protobufjs` v6.x. The v6.x branch of protobufjs has [known vulnerabilities](https://github.com/protobufjs/protobuf.js/security/advisories). Your vault content is never sent to the network — the only external traffic is the one-time model download from HuggingFace. The risk is limited to the model download path and is inherited from the supply chain; it cannot be patched from this package until upstream updates.

### Troubleshooting

**`command not found: obsidian-vaultgate-mcp`**
The npm global bin directory is not on `PATH`. Run `npm bin -g` to find it, then add to your shell profile. Or invoke via `npx obsidian-vaultgate-mcp`.

**`command not found: obsidian` (the CLI binary)**
The CLI has not been registered. See [Register the Obsidian CLI](#1-register-the-obsidian-cli) above.

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

## Tray Companion App

A menu-bar app that wraps the same VaultGate MCP server core in a native macOS GUI — no terminal needed. It exposes the [same 34 + 5 tools](#available-tools) as the headless package, and adds a layer of GUI conveniences on top:

<div align="center">

[![Download DMG — macOS Apple Silicon](https://img.shields.io/badge/Download_DMG-macOS_Apple_Silicon-7c3aed?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/mkemeter/obsidian-vaultgate-mcp/releases/latest)

</div>

<table>
<tr>
<td width="50%">

**📊 Menu bar status at a glance**
The tray icon shows server state — running, indexing, error — without opening a terminal.

</td>
<td width="50%">

**🔍 Pre-bundled Smart Search**
The embedding model (~34 MB) ships inside the app. Fully offline — no download, no network call, ever.

</td>
</tr>
<tr>
<td>

**🔗 One-click connection URL**
Click once to copy `http://127.0.0.1:3001/mcp` to your clipboard and paste into any AI client.

</td>
<td>

**🚀 Open at Login**
Native macOS login-items registration. No `launchctl` tweaking — just toggle the switch.

</td>
</tr>
<tr>
<td>

**📋 Logs in two clicks**
Server stdout/stderr forwarded to a rotating log file. Open it with one menu click.

</td>
<td>

**⚙️ Full preferences window**
Vault selector, port, Obsidian binary path — all in a UI. No config files to edit manually.

</td>
</tr>
</table>

### Platforms

| Platform | Tray companion | Headless npm package |
|----------|----------------|----------------------|
| macOS (Apple Silicon) | ✅ DMG | ✅ |
| macOS (Intel) | ❌ | ✅ |
| Windows | ❌ | ✅ |
| Linux | ❌ | ✅ (`deploy/systemd/`) |

### Install

1. Download `VaultGate-X.Y.Z-mac-arm64.dmg` from the [latest release](https://github.com/mkemeter/obsidian-vaultgate-mcp/releases/latest).
2. Open the DMG and drag **VaultGate** into `Applications`.
3. **Bypass Gatekeeper** (the app is unsigned — see [Code signing](#code-signing) below):

   > [!WARNING]
   > On macOS 15.1 and later, Apple removed the "Open Anyway" GUI button. Run this command in Terminal before launching:
   >
   > ```bash
   > xattr -r -d com.apple.quarantine /Applications/VaultGate.app
   > ```
   >
   > On older macOS you can right-click → Open the app and click "Open" in the dialog instead.

4. Launch VaultGate from Applications. The tray icon appears in the menu bar.

### First run

On first launch VaultGate will:

1. **Auto-detect Obsidian.** It probes the standard install path (`/Applications/Obsidian.app/Contents/MacOS/obsidian`).
2. **Auto-detect your vault.** It reads Obsidian's `obsidian.json` to enumerate registered vaults. If exactly one vault is registered, that one is selected silently. If multiple vaults exist, the active one is used (you can pin a specific vault from Preferences).
3. **Start the bundled MCP server** on `http://127.0.0.1:3001/mcp`.
4. **Begin indexing** for Smart Search in the background. The tray menu shows "○ Building index (N/M)…" while this runs, then flips to "✓ Smart search ready — N notes". A native notification fires once when this completes.

If anything goes wrong, the tray icon menu surfaces the failure mode:

| Menu shows | What to do |
|------------|------------|
| `○ Obsidian not found` | Click **Preferences…** and use **Browse…** to locate Obsidian's binary. |
| `○ Obsidian CLI not registered` | In Obsidian: **Settings → General → Command line interface → Register CLI**, then click **Start** in the tray menu. |
| `○ Error — port in use` | Open **Preferences…** and change the port (default `3001`). Common conflicts: another VaultGate instance, a different MCP server. |
| `○ Error — server crashed` | Click **Open Logs…** and inspect the bottom of the file. The server retries with exponential backoff (1s → 2s → 4s) for up to three rapid crashes, then gives up. |

### Connect an AI client

After the tray icon shows `● Running — <Vault Name>`:

1. Click the tray icon → **Copy Connection URL**.
2. Paste `http://127.0.0.1:3001/mcp` into your client's MCP configuration:
   - **Cursor / Windsurf / Zed**: add it as a Streamable HTTP MCP server.
   - **Claude Code**: prefer the npm-package + stdio transport (see [Claude Code](#claude-code) above).

The URL never leaves `127.0.0.1` — it is bound to localhost and refuses other origins.

### Preferences

Opens via the tray menu → **Preferences…**.

| Field | What it does |
|-------|--------------|
| **Vault** | Drop-down of vaults registered with Obsidian. Pick a specific vault, or leave on **Active vault (default)** to use whichever vault is currently focused in Obsidian. |
| **Local server port** | The HTTP port VaultGate binds to. Default `3001`. Change this if another process owns the port. |
| **Obsidian binary** | Auto-detected; override with **Browse…** if your install lives in a non-standard location. |
| **Open VaultGate at login** | Native macOS login-item registration (System Settings → General → Login Items). |

Saving any change **restarts the server** so the new settings take effect immediately.

### Smart Search

The tray app ships with the [`Xenova/bge-small-en-v1.5`](https://huggingface.co/Xenova/bge-small-en-v1.5) embedding model pre-bundled (~34 MB). On first launch:

- The model is loaded from the bundle — **no download, no network call**.
- A background job embeds your vault note-by-note. Progress is shown in the tray menu (`○ Building index (142/523)…`).
- All 34 base tools work the entire time — only the 5 semantic tools (`semantic_search`, `find_similar`, `index_vault`, `vault_info`, `clear_index`) wait for the index.

The first time the index reaches "ready", a one-time native notification fires. The state then persists: subsequent restarts pick up the cached index from `~/.cache/obsidian-vaultgate-mcp/`.

If the index gets stuck or you switch vaults aggressively, run `clear_index` from your AI client to wipe the cache and rebuild from scratch.

### Logs

The tray menu's **Open Logs…** opens `vaultgate.log` from the user-data directory:

| Platform | Log file |
|----------|----------|
| macOS | `~/Library/Application Support/VaultGate/vaultgate.log` |

Logs rotate at 10 MB; up to three files are retained (`vaultgate.log`, `.log.1`, `.log.2`).

### Quitting and uninstalling

- **Quit**: tray menu → **Quit VaultGate**. Sends `SIGTERM` to the bundled server, waits up to 3 s for in-flight HTTP requests to drain, then exits.
- **Uninstall**: drag `VaultGate.app` to the Trash. Optionally delete `~/Library/Application Support/VaultGate/` to remove logs and config.

<details>
<summary>Code signing</summary>

VaultGate's tray app is **currently unsigned**. We don't ship a code-signing certificate because an Apple Developer Program membership ($99 / year) is out of scope for an early release.

The audience for this app — developers building MCP integrations — handles unsigned binaries routinely. The trade-off is a one-time `xattr` command on first install.

</details>

---

## Privacy and Security

- **Local execution only.** All vault operations go through the running Obsidian instance — never directly to the file system. Obsidian's internal state (links, indexes, plugin context) stays consistent.
- **Loopback-only binding.** The HTTP server listens on `127.0.0.1` and is unreachable from other hosts on the network.
- **Explicit write consent.** Every write operation requires a two-step interaction: preview followed by confirmation. No file is modified in a single tool call.
- **No credentials.** Access is scoped to the local user session — no tokens, API keys, or authentication required.
- **Open source, copyleft.** GPLv3 ensures the source stays open. Inspect exactly what runs on your machine.

---

## Repository Layout

```
obsidian-vaultgate-mcp/
├── server/         The npm package (obsidian-vaultgate-mcp on npm)
│   ├── src/        TypeScript sources
│   ├── tests/      Vitest test suite
│   └── deploy/     launchd / systemd / Task Scheduler install scripts
├── tray/           VaultGate tray companion app (Electron, macOS arm64)
│   ├── src/
│   ├── renderer/   Preferences window HTML
│   └── assets/     Icons + pre-bundled embedding model
├── docs/           Shared cross-cutting documentation
│   ├── CONTRIBUTING.md
│   ├── CHANGELOG.md
│   └── SECURITY.md
└── .github/workflows/      CI (ci.yml = server, tray.yml = tray)
```

---

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the architecture overview, dev setup for both distributions, testing conventions, code style, and the tray-specific developer guide.

```bash
git clone https://github.com/mkemeter/obsidian-vaultgate-mcp.git
cd obsidian-vaultgate-mcp/server
npm install
npm test
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
