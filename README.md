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

[![Tray app — macOS Apple Silicon](https://img.shields.io/badge/Tray_app-macOS_Apple_Silicon-7c3aed?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/mkemeter/obsidian-vaultgate-mcp/tree/main/tray)
&nbsp;&nbsp;
[![Headless npm package](https://img.shields.io/badge/Headless_npm_package-Linux_%7C_Windows_%7C_macOS-3b82f6?style=for-the-badge&logo=npm&logoColor=white)](https://github.com/mkemeter/obsidian-vaultgate-mcp/tree/main/server)

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

## 🚀 Get started

VaultGate ships in two distributions that share the same MCP server core. You don't need both.

| | 📦 Headless npm package | 🖥️ Tray companion app |
|---|---|---|
| **Install** | `npm install -g obsidian-vaultgate-mcp` | DMG drag-and-drop |
| **UI** | None — CLI / daemon | Menu bar icon |
| **Autostart** | launchd / systemd / Task Scheduler | Toggle in tray menu |
| **Smart Search model** | Downloaded on first use | Pre-bundled, fully offline |
| **macOS** | ✅ | ✅ Apple Silicon only |
| **Windows** | ✅ | ❌ |
| **Linux** | ✅ | ❌ |
| **Bundle size** | ~6 MB + lazy model | ~200 MB DMG |
| **Full docs** | [server/README.md](server/README.md) | [tray/README.md](tray/README.md) |

> [!NOTE]
> Requires **Obsidian 1.8.9 or later** on all paths. The npm package additionally requires **Node.js 18+**.

---

## 📂 Repository layout

```
obsidian-vaultgate-mcp/
├── server/         The npm package (obsidian-vaultgate-mcp on npm)
│   ├── src/        TypeScript sources
│   ├── tests/      Vitest test suite
│   ├── deploy/     launchd / systemd / Task Scheduler install scripts
│   └── README.md   ← user docs for the npm distribution
├── tray/           VaultGate tray companion app (Electron, macOS arm64)
│   ├── src/
│   ├── renderer/   Preferences window HTML
│   ├── assets/     Icons + pre-bundled embedding model
│   └── README.md   ← user docs for the tray distribution
├── docs/           Shared cross-cutting documentation
│   ├── CONTRIBUTING.md
│   ├── TRAY-DEV.md
│   ├── CHANGELOG.md
│   └── SECURITY.md
└── .github/workflows/      CI (ci.yml = server, tray.yml = tray)
```

---

## 🤝 Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the architecture overview, dev setup for both distributions, testing conventions, and code style. For tray-specific details (Electron architecture, packaging), see [docs/TRAY-DEV.md](docs/TRAY-DEV.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
