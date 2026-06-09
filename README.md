# obsidian-mcp-http

> Let your AI assistant read and write your Obsidian notes — privately, on your own machine.

[![npm version](https://img.shields.io/npm/v/obsidian-mcp-http)](https://www.npmjs.com/package/obsidian-mcp-http)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](#)

`obsidian-mcp-http` is a small program that runs on your computer and lets AI assistants (like Claude, Cursor, or any other MCP-compatible tool) talk directly to your Obsidian vault. No cloud sync. No third-party accounts. Your notes stay on your machine.

**What can the AI do once connected?**
- Read and search your notes
- Create new notes, append or prepend content
- Read your tasks and daily notes
- Search by meaning, not just keywords (optional)

**What can't it do without your permission?**
Nothing. Every write operation shows you a preview first. The AI has to ask you before changing anything.

---

## Before you start

You need two things installed on your computer:

1. **Obsidian** — version 1.12.4 or later. [Download here](https://obsidian.md/download) if you don't have it.
2. **Node.js** — version 18 or later. [Download here](https://nodejs.org/en/download) if you don't have it.

> **How do I check if Node.js is installed?**
> Open Terminal (Mac/Linux) or Command Prompt (Windows), type `node --version`, and press Enter.
> If you see something like `v20.11.0`, you're good. If you get an error, install Node.js first.

---

## Setup (one time only)

### Step 1 — Enable the Obsidian CLI

The Obsidian CLI is a built-in feature that lets other programs (like this one) talk to Obsidian. It ships with Obsidian — you just need to turn it on.

1. Open Obsidian
2. Go to **Settings** (the gear icon, bottom-left)
3. Click **General**
4. Scroll down to **Command line interface**
5. Click **Register CLI**

That's it. You only do this once.

> **Catalyst license?** Not needed. The CLI is free for everyone since Obsidian 1.12.4.

---

### Step 2 — Install obsidian-mcp-http

Open Terminal (Mac/Linux) or Command Prompt (Windows) and run:

```bash
npm install -g obsidian-mcp-http
```

Wait for it to finish. You'll see a lot of text scroll by — that's normal.

> **Getting a "permission denied" error on Mac/Linux?** Try: `sudo npm install -g obsidian-mcp-http`

---

### Step 3 — Connect your AI assistant

Pick the section that matches how you use your AI assistant:

- [HTTP client (most desktop AI apps)](#connecting-an-http-client)
- [Claude Code (terminal-based)](#connecting-claude-code)

---

## Connecting an HTTP client

Most desktop AI apps (Cursor, Windsurf, Zed, and others) connect to MCP servers via a URL. Here's how:

**Start the server:**

```bash
obsidian-mcp-http
```

If you have **multiple vaults**, specify which one:

```bash
OBSIDIAN_VAULT="My Vault Name" obsidian-mcp-http
```

Replace `My Vault Name` with the exact name of your vault (it's the folder name in your file system).

**You should see:**

```
✓ obsidian-mcp-http running at http://127.0.0.1:3001
  Streamable HTTP: POST http://127.0.0.1:3001/mcp
  SSE (legacy):    GET  http://127.0.0.1:3001/sse
  Health:          GET  http://127.0.0.1:3001/health
```

**In your AI app:** add a new MCP server and enter the URL `http://localhost:3001`.

> **Which URL to use?** Try `http://localhost:3001/mcp` first (modern). If your app has a "legacy SSE" option, use `http://localhost:3001/sse` instead.

---

## Connecting Claude Code

Add this to your `~/.claude/settings.json` file:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "obsidian-mcp-http",
      "env": {
        "OBSIDIAN_VAULT": "My Vault Name"
      }
    }
  }
}
```

Replace `My Vault Name` with the exact name of your vault. If you only have one vault, you can remove the `"env"` section entirely.

Claude Code starts and stops the server automatically — you don't need to run anything manually.

---

## Start the server automatically at login (optional)

If you use an HTTP client, you probably want the server running in the background all the time. Here's how to set that up:

### Mac

Run this once in Terminal:

```bash
cd $(npm root -g)/obsidian-mcp-http
./launchd/install.sh
```

The script fills in the correct paths automatically and sets up the server to start when you log in.

> **Side effect:** Obsidian itself will also open at login. This is needed because the server checks that Obsidian is reachable when it starts.

To remove the auto-start:

```bash
launchctl unload ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
rm ~/Library/LaunchAgents/com.obsidian-mcp-http.plist
```

### Windows

1. Press **Win + R**, type `taskschd.msc`, press Enter
2. Click **Create Basic Task** (right panel)
3. Name it `obsidian-mcp-http`, click Next
4. Trigger: choose **When I log on**, click Next
5. Action: choose **Start a program**, click Next
6. Program/script: find `node.exe` — usually `C:\Program Files\nodejs\node.exe`
7. Arguments: the path to `obsidian-mcp-http` — run `npm root -g` in Command Prompt to find it
8. Click Finish

To pass your vault name, add `OBSIDIAN_VAULT=My Vault Name` as an environment variable in the task settings (Actions tab → Edit → Environment variables).

### Linux

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/obsidian-mcp-http.service << 'EOF'
[Unit]
Description=obsidian-mcp-http MCP server

[Service]
ExecStart=/usr/bin/node /usr/lib/node_modules/obsidian-mcp-http/build/index.js
Environment=OBSIDIAN_VAULT=My Vault Name
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user enable --now obsidian-mcp-http
```

Replace `My Vault Name` with your vault name, and adjust the paths to match your system (`which node` and `npm root -g` will give you the correct paths).

---

## Configuration

You can change the server's behaviour using environment variables. You don't need to set any of these to get started — the defaults work for most people.

| Variable | Default | What it does |
|----------|---------|-------------|
| `OBSIDIAN_VAULT` | _(last opened vault)_ | Which vault to use. Set this if you have more than one vault. |
| `OBSIDIAN_MCP_PORT` | `3001` | The port the server listens on. Change this if 3001 is already in use by another program. |
| `OBSIDIAN_CLI_PATH` | `obsidian` | Full path to the Obsidian app. Usually only needed for auto-start setups (launchd, Task Scheduler, systemd) where the system PATH is different from your terminal's. |

**How to set these:** prefix the variable before the command in your terminal:

```bash
OBSIDIAN_VAULT="Work Notes" OBSIDIAN_MCP_PORT=3002 obsidian-mcp-http
```

---

## What the AI can do

Once connected, your AI assistant has access to these tools. You don't need to set them up — they're all available automatically.

### Reading (safe — no confirmation needed)

| Tool | What it does |
|------|-------------|
| `files_list` | Lists all notes in your vault |
| `files_read` | Reads the full text of a note |
| `search` | Searches for text across all your notes |
| `daily_read` | Reads today's daily note |
| `tasks_all` | Shows all tasks (done and to-do) |
| `tasks_pending` | Shows only unchecked tasks |
| `tasks_daily` | Shows today's unchecked tasks |
| `templates_list` | Lists your note templates |
| `property_read` | Reads the YAML frontmatter of a note |
| `tags` | Lists all tags in your vault |
| `backlinks` | Finds notes that link to a specific note |
| `unresolved` | Finds broken links (links to notes that don't exist) |
| `plugins_list` | Lists installed plugins |
| `dev_errors` | Shows recent Obsidian error messages |
| `dev_console` | Shows Obsidian console messages |
| `dev_css` | Inspects the computed CSS of an element |
| `dev_dom` | Inspects the DOM structure of the Obsidian window |

### Semantic search (optional — requires first-run download)

These tools understand *meaning*, not just keywords. "What did I write about feeling overwhelmed?" will find relevant notes even if they don't contain that exact phrase.

| Tool | What it does |
|------|-------------|
| `semantic_search` | Finds notes by meaning |
| `find_similar` | Finds notes similar to a given note |
| `vault_info` | Shows how many notes are indexed and when |
| `index_vault` | Forces a full re-index (rarely needed) |

> **First-run download:** On first use, a small AI model (~100 MB) is downloaded once to your computer. After that it runs entirely offline — no internet connection needed for search.
>
> The index builds in the background when you start the server. Your first semantic search may return "still indexing" — try again after a minute.

### Writing (always shows a preview first)

Every write tool defaults to **preview mode** — the AI shows you what it's about to do and must wait for you to say "yes, go ahead" before making any change. You will never be surprised by an edit you didn't approve.

| Tool | What it does |
|------|-------------|
| `note_create` | Creates a new note |
| `note_append` | Adds content to the end of a note |
| `note_prepend` | Adds content to the top of a note (great for reverse-chronological logs) |
| `note_update` | Replaces the full content of an existing note (always use with an exact vault path) |
| `daily_append` | Adds content to today's daily note |
| `templates_apply` | Applies one of your templates to a note |
| `property_set` | Sets or updates a frontmatter property |
| `plugin_reload` | Reloads an Obsidian plugin |
| `dev_screenshot` | Saves a screenshot of Obsidian to a file |
| `dev_mobile` | Toggles mobile-screen emulation in Obsidian |
| `eval` ⚠️ | Runs arbitrary JavaScript inside Obsidian — only approve if you know what the code does |

---

## Troubleshooting

**"command not found: obsidian-mcp-http"**
Node.js global packages aren't on your PATH. Try restarting your terminal, or run the full path: `npx obsidian-mcp-http`.

**"command not found: obsidian" (the CLI, not the app)**
You haven't registered the CLI yet. Go back to [Step 1](#step-1--enable-the-obsidian-cli).

**The server starts but the AI says "no tools available"**
Disconnect and reconnect in your AI app to trigger a fresh session — this clears any stale connection state.

**Semantic search says "still indexing"**
The index builds in the background after startup. Wait 30–60 seconds and try again. For large vaults it can take a few minutes.

**Port 3001 already in use**
Another program is using that port. Start the server on a different port: `OBSIDIAN_MCP_PORT=3002 obsidian-mcp-http` and update the URL in your AI app accordingly.

**Obsidian opens at login and you don't want that**
Remove the auto-start agent (see [Mac](#mac) uninstall steps above).

---

## Privacy and security

- **Nothing leaves your computer.** Notes are only ever passed to the local `obsidian` process. No cloud, no analytics, no telemetry.
- **Localhost only.** The HTTP server listens only on `127.0.0.1` — it is not reachable from other devices on your network.
- **Preview before every write.** All write operations default to preview mode. The AI cannot modify your notes without your explicit approval on each call.
- **No login required.** The server trusts only the local user — no passwords or tokens needed.

---

## Requirements

- **Obsidian** v1.12.4 or later
- **Node.js** 18 or later
- **macOS, Windows, or Linux**

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture details, how to add a tool, and the PR checklist.

```bash
git clone https://github.com/mkemeter/obsidian-mcp-http.git
cd obsidian-mcp-http
npm install
npm test
```

---

## License

GPL v3 or later — see [LICENSE](LICENSE).
