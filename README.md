# VaultGate

> Your Obsidian vault, accessible to any AI assistant — locally, privately, with no plugins.

[![npm version](https://img.shields.io/npm/v/obsidian-vaultgate-mcp)](https://www.npmjs.com/package/obsidian-vaultgate-mcp)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org)
[![Tests](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mkemeter/obsidian-vaultgate-mcp/actions/workflows/ci.yml)

VaultGate is a local [Model Context Protocol](https://modelcontextprotocol.io) server that bridges any MCP-compatible AI client with your Obsidian vault. It is built on Obsidian's native integration APIs — no community plugins, no cloud relay, no API keys.

Ask your AI to read notes, run full-text or semantic search, manage tasks, apply templates, write content, and open anything directly in the Obsidian UI. Every write goes through a dry-run preview first, so you stay in control of what actually changes.

🔒 **Private by design** — Note content never leaves your machine. Binds to `127.0.0.1` only.
🔐 **Obsidian stays in control** — The AI never accesses your files directly. Every operation is mediated by the running Obsidian instance.
🔌 **No plugins required** — Relies entirely on Obsidian's built-in integration APIs.
🤖 **Works with any MCP client** — Claude, Cursor, Windsurf, Zed, and anything else that speaks MCP.
🔍 **Semantic search** — Query your vault by meaning, not just keywords — fully offline.
✋ **Explicit write consent** — Every change requires a two-step preview + confirm.
🪟 **GUI navigation** — Open any note, search result, or daily note directly in Obsidian.

---

## How VaultGate is delivered

This repository ships **two distributions** that share the same MCP server core. Pick whichever fits your setup; you don't need both.

### 📦 [`server/`](server/) — Headless npm package

The reference distribution: `npm install -g obsidian-vaultgate-mcp`. Runs as a stdio child of MCP clients (Claude Code) or as a background HTTP daemon (launchd / systemd / Task Scheduler). Linux supported.

**Best for:** headless setups, Claude Code via stdio, scripted environments, Linux.

→ **Install and usage:** [`server/README.md`](server/README.md)

### 🖥️ [`tray/`](tray/) — VaultGate tray companion app

An Electron menu-bar / system-tray app that runs the MCP server in the background, with a one-click Smart Search index, autostart toggle, and a "copy connection URL" button. Pre-bundled embedding model — works fully offline on first launch.

**Best for:** day-to-day use with a GUI. macOS Apple Silicon.

→ **Install and usage:** [`tray/README.md`](tray/README.md)

### Comparison

| | Headless npm package | Tray companion |
|---|---|---|
| Install | `npm install -g obsidian-vaultgate-mcp` | DMG |
| UI | None (CLI only) | Menu bar |
| Autostart | launchd / systemd / Task Scheduler | Toggle in tray menu |
| Smart Search model | Downloaded on first use | Pre-bundled (offline) |
| macOS | ✅ | ✅ Apple Silicon only |
| Windows | ✅ | ❌ |
| Linux | ✅ | ❌ |
| Bundle size | ~6 MB + lazy model | ~150 MB DMG |

---

## Repository layout

```
obsidian-vaultgate-mcp/
├── server/         The npm package (obsidian-vaultgate-mcp on npm)
│   ├── src/        TypeScript sources
│   ├── tests/      Vitest test suite
│   ├── deploy/     launchd / systemd / Task Scheduler install scripts
│   ├── docs/       Package-specific config examples
│   ├── package.json
│   └── README.md   ← user-facing docs for the npm distribution
├── tray/           VaultGate tray companion app (Electron)
│   ├── src/
│   ├── tests/
│   ├── renderer/   Preferences window HTML
│   ├── assets/     Icons + pre-bundled embedding model (gitignored, fetched at build)
│   ├── package.json
│   └── README.md   ← user-facing docs for the tray distribution
├── docs/           Shared cross-cutting documentation
│   ├── CONTRIBUTING.md     Architecture + dev workflow for both distributions
│   ├── TRAY-DEV.md         Detailed tray app developer guide
│   ├── CHANGELOG.md
│   └── SECURITY.md
└── .github/workflows/      Per-distribution CI (ci.yml = server, tray.yml = tray)
```

---

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the architecture overview, dev setup for both distributions, testing conventions, and code style.

For tray-specific contribution details (Electron architecture, native-addon handling, packaging), see [docs/TRAY-DEV.md](docs/TRAY-DEV.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
