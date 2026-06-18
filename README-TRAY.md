<div align="center">

<img src="tray/assets/icon.svg" width="80" alt="VaultGate" />

# VaultGate

**Your Obsidian vault, accessible to any AI assistant — from your menu bar, no terminal needed.**

[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-black?logo=apple)](https://github.com/mkemeter/obsidian-vaultgate-mcp/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

</div>

A menu-bar app that runs the VaultGate MCP server in the background — with a pre-bundled Smart Search model, one-click connection URL, autostart, and logs in two clicks.

> [!NOTE]
> The tray companion is **optional**. The headless [`obsidian-vaultgate-mcp`](https://www.npmjs.com/package/obsidian-vaultgate-mcp) npm package is the reference distribution and is unaffected by anything here. Use the tray app if you want a GUI instead of the command line.

---

## ✨ Features

<table>
<tr>
<td width="50%">

**📊 Menu bar status at a glance**
The tray icon shows server state at a glance — running, indexing, error — without opening a terminal.

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

---

## Contents

- [Platforms](#%EF%B8%8F-platforms)
- [Install](#-install)
- [First run](#-first-run)
- [Connecting an AI client](#-connecting-an-ai-client)
- [Preferences](#%EF%B8%8F-preferences)
- [Smart Search](#-smart-search)
- [Logs](#-logs)
- [Quitting and uninstalling](#%EF%B8%8F-quitting-and-uninstalling)
- [Code signing](#code-signing)
- [Compared to the npm package](#compared-to-the-npm-package)
- [Contributing](#-contributing--building-from-source)
- [License](#license)

---

## 🖥️ Platforms

| Platform | Tray companion | Headless npm package |
|----------|----------------|----------------------|
| macOS (Apple Silicon) | ✅ DMG | ✅ |
| macOS (Intel) | ❌ Use the npm package | ✅ |
| Windows | ❌ Use the npm package | ✅ |
| Linux | ❌ Use the npm package + `deploy/systemd/` | ✅ |

---

## 🚀 Install

> **Releases at:** [github.com/mkemeter/obsidian-vaultgate-mcp/releases](https://github.com/mkemeter/obsidian-vaultgate-mcp/releases) — `v*` tags

### macOS (Apple Silicon)

1. Download `VaultGate-X.Y.Z-mac-arm64.dmg` from the latest `v*` release.
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

---

## 🔮 First run

On first launch VaultGate will:

1. **Auto-detect Obsidian.** It probes the standard install path:
   - macOS: `/Applications/Obsidian.app/Contents/MacOS/obsidian`
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

---

## 🔗 Connecting an AI client

After the tray icon shows `● Running — <Vault Name>`:

1. Click the tray icon → **Copy Connection URL**.
2. Paste `http://127.0.0.1:3001/mcp` into your client's MCP configuration:
   - **Cursor / Windsurf / Zed**: add it as a Streamable HTTP MCP server.
   - **Claude Code**: prefer the npm-package + stdio transport for now (HTTP MCP support varies by client version).

The URL never leaves `127.0.0.1` — it is bound to localhost and refuses other origins.

---

## ⚙️ Preferences

Opens via the tray menu → **Preferences…**.

| Field | What it does |
|-------|--------------|
| **Vault** | Drop-down of vaults registered with Obsidian. Pick a specific vault, or leave on **Active vault (default)** to use whichever vault is currently focused in Obsidian. |
| **Local server port** | The HTTP port VaultGate binds to. Default `3001`. Change this if another process owns the port. |
| **Obsidian binary** | Auto-detected; override with **Browse…** if your install lives in a non-standard location. |
| **Open VaultGate at login** | Native macOS login-item registration (System Settings → General → Login Items). |

Saving any change **restarts the server** so the new settings take effect immediately. The connection URL on the menu bar updates the moment the new server is up.

---

## 🔍 Smart Search

VaultGate's tray app ships with the [`Xenova/bge-small-en-v1.5`](https://huggingface.co/Xenova/bge-small-en-v1.5) embedding model pre-bundled (~34 MB). On first launch:

- The model is loaded from the bundle — **no download, no network call**.
- A background job embeds your vault note-by-note. Progress is shown in the tray menu (`○ Building index (142/523)…`).
- All 34 base tools work the entire time — only the 5 semantic tools (`semantic_search`, `find_similar`, `index_vault`, `index_status`, `clear_index`) wait for the index.

The first time the index reaches "ready", a one-time native notification fires. The state then persists: subsequent restarts pick up the cached index from `~/.cache/obsidian-vaultgate-mcp/`.

If the index gets stuck or you switch vaults aggressively, run the headless `clear_index` tool from your AI client to wipe the cache and rebuild from scratch.

---

## 📋 Logs

The tray menu's **Open Logs…** opens `vaultgate.log` from the user-data directory:

| Platform | Log file |
|----------|----------|
| macOS | `~/Library/Application Support/VaultGate/vaultgate.log` |

Logs rotate at 10 MB; up to three files are retained (`vaultgate.log`, `.log.1`, `.log.2`).

---

## 🗑️ Quitting and uninstalling

- **Quit**: tray menu → **Quit VaultGate**. Sends `SIGTERM` to the bundled server, waits up to 3 s for in-flight HTTP requests to drain, then exits.
- **Uninstall**: drag `VaultGate.app` to the Trash. Optionally delete `~/Library/Application Support/VaultGate/` to remove logs and config.

---

<details>
<summary>Code signing</summary>

VaultGate's tray app is **currently unsigned**. We don't ship a code-signing certificate because an Apple Developer Program membership ($99 / year) is out of scope for an early release.

The audience for this app — developers building MCP integrations — handles unsigned binaries routinely. The trade-off is a one-time `xattr` command on first install.

Notarization via the Apple Developer Program is not currently available.

</details>

---

## Compared to the npm package

| | Tray app | `obsidian-vaultgate-mcp` (npm) |
|---|----------|---------------------------------|
| Install | Drag-and-drop DMG | `npm install -g …` |
| UI | Menu bar | None (CLI only) |
| Autostart | Toggle in tray menu | Manual via launchd / systemd |
| Smart Search model | Pre-bundled (offline) | Downloaded on first use |
| Updates | Manual download from GitHub releases | `npm update -g obsidian-vaultgate-mcp` |
| Linux / Windows | ❌ | ✅ |
| Bundle size | ~200 MB DMG | ~6 MB + lazily-loaded model |
| Best for | Day-to-day use on macOS | Headless servers, Claude Code via stdio, Linux, Windows, scripting |

You can mix the two: stop the tray app (or quit it), then run the npm package on the same machine — they don't fight as long as they don't bind the same port.

---

## 🤝 Contributing / building from source

See [docs/TRAY-DEV.md](docs/TRAY-DEV.md) for the developer guide: dev mode, build pipeline, packaging, CI, and how the tray app talks to the bundled server through `utilityProcess.fork()`.

---

## License

GPL-3.0-or-later. Same as the rest of the project. See [LICENSE](LICENSE).
