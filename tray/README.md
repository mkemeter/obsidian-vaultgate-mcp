# VaultGate Tray Companion

> A menu-bar / system-tray app that runs the VaultGate MCP server in the background, with a one-click Smart Search index, autostart, and a "copy connection URL" button.

The tray companion is **optional**. The headless [`obsidian-vaultgate-mcp`](https://www.npmjs.com/package/obsidian-vaultgate-mcp) npm package remains the reference distribution and is unaffected by anything in this folder. Use the tray app if you want a GUI for what the npm package does on the command line.

---

## Platforms

| Platform | Tray companion | Headless npm package |
|----------|----------------|----------------------|
| macOS (Apple Silicon) | ✅ DMG | ✅ |
| macOS (Intel) | ❌ Phase 2 (universal build) — use the npm package | ✅ |
| Windows (x64) | ✅ NSIS installer | ✅ |
| Linux | ❌ Use the npm package + `deploy/systemd/` | ✅ |

The tray app drops Linux because system-tray APIs there are too fragmented to support reliably. The headless npm path continues to support Linux via the `deploy/systemd/` install script.

---

## What it gives you

- **Menu bar / system tray icon** — at-a-glance "is the server running?".
- **Pre-bundled Smart Search** — the embedding model (~34 MB) ships inside the app, indexes silently on first run, and works fully offline.
- **Copy Connection URL** — click once to put `http://127.0.0.1:3001/mcp` on your clipboard for pasting into Claude Code, Cursor, Windsurf, Zed, etc.
- **Open at Login toggle** — uses the OS's native login-items registration (System Settings → Login Items on macOS, registry `Run` key on Windows). No `launchctl`/Task Scheduler tweaking needed.
- **Logs in two clicks** — the server's stdout / stderr are forwarded to a rotating log file; "Open Logs…" opens it in your default editor.
- **Built-in update check** — non-blocking, queries the npm registry once at startup, surfaces an "Update available — vX.Y.Z" menu item that links to the release page. No auto-download.

---

## Install

> **Releases land at:** [github.com/mkemeter/obsidian-vaultgate-mcp/releases](https://github.com/mkemeter/obsidian-vaultgate-mcp/releases) under `tray/v*` tags.

### macOS (Apple Silicon)

1. Download `VaultGate-X.Y.Z-mac-arm64.dmg` from the latest `tray/v*` release.
2. Open the DMG and drag **VaultGate** into `Applications`.
3. **Bypass Gatekeeper** (the app is unsigned — see [Code signing](#code-signing) below for context):

   ```bash
   xattr -r -d com.apple.quarantine /Applications/VaultGate.app
   ```

   On macOS 15.1 and later this terminal command is **required** — Apple removed the "Open Anyway" GUI button in System Settings. On older macOS you can still right-click → Open the app the first time and click "Open" in the dialog.
4. Launch VaultGate from Applications. The tray icon appears in the menu bar.

### Windows (x64)

1. Download `VaultGate-X.Y.Z-win-x64-setup.exe` from the latest `tray/v*` release.
2. Run the installer.
3. **SmartScreen warning** (the installer is unsigned): click **More info → Run anyway**.
4. Choose an install location and finish the wizard.
5. VaultGate launches automatically (if you left "Run after finish" checked) and adds an icon to the system tray.

---

## First run

On first launch VaultGate will:

1. **Auto-detect Obsidian.** It probes the standard install paths:
   - macOS: `/Applications/Obsidian.app/Contents/MacOS/obsidian`
   - Windows: `%LOCALAPPDATA%\Obsidian\Obsidian.exe`, then `%ProgramFiles%\Obsidian\Obsidian.exe`
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

## Connecting an AI client

After the tray icon shows `● Running — <Vault Name>`:

1. Click the tray icon → **Copy Connection URL**.
2. Paste `http://127.0.0.1:3001/mcp` into your client's MCP configuration:
   - **Cursor / Windsurf / Zed**: add it as a Streamable HTTP MCP server.
   - **Claude Code**: prefer the npm-package + stdio transport for now (HTTP MCP support varies by client version).

The URL never leaves `127.0.0.1` — it is bound to localhost and refuses other origins.

---

## Preferences

Opens via the tray menu → **Preferences…**.

| Field | What it does |
|-------|--------------|
| **Vault** | Drop-down of vaults registered with Obsidian. Pick a specific vault, or leave on **Active vault (default)** to use whichever vault is currently focused in Obsidian. |
| **Local server port** | The HTTP port VaultGate binds to. Default `3001`. Change this if another process owns the port. |
| **Obsidian binary** | Auto-detected; override with **Browse…** if your install lives in a non-standard location. |
| **Open VaultGate at login** | Native OS login-item registration. macOS surfaces this in System Settings → General → Login Items. Windows uses `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. |

Saving any change **restarts the server** so the new settings take effect immediately. The connection URL on the menu bar updates the moment the new server is up.

---

## Smart Search

VaultGate's tray app ships with the [`Xenova/bge-small-en-v1.5`](https://huggingface.co/Xenova/bge-small-en-v1.5) embedding model pre-bundled (~34 MB). On first launch:

- The model is loaded from the bundle — **no download, no network call**.
- A background job embeds your vault note-by-note. Progress is shown in the tray menu (`○ Building index (142/523)…`).
- All 34 base tools work the entire time — only the 5 semantic tools (`semantic_search`, `find_similar`, `index_vault`, `index_status`, `clear_index`) wait for the index.

The first time the index reaches "ready", a one-time native notification fires. The state then persists: subsequent restarts pick up the cached index from `~/.cache/obsidian-vaultgate-mcp/`.

If the index gets stuck or you switch vaults aggressively, run the headless `clear_index` tool from your AI client to wipe the cache and rebuild from scratch.

---

## Logs

The tray menu's **Open Logs…** opens `vaultgate.log` from the user-data directory:

| Platform | Log file |
|----------|----------|
| macOS | `~/Library/Application Support/VaultGate/vaultgate.log` |
| Windows | `%APPDATA%\VaultGate\vaultgate.log` |

Logs rotate at 10 MB; up to three files are retained (`vaultgate.log`, `.log.1`, `.log.2`).

---

## Quitting and uninstalling

- **Quit**: tray menu → **Quit VaultGate**. Sends `SIGTERM` to the bundled server, waits up to 3 s for in-flight HTTP requests to drain, then exits.
- **Uninstall (macOS)**: drag `VaultGate.app` to the Trash. Optionally delete `~/Library/Application Support/VaultGate/` to remove logs and config.
- **Uninstall (Windows)**: use **Settings → Apps → Installed apps → VaultGate → Uninstall**.

---

## Code signing

VaultGate's tray app is **currently unsigned** for both macOS and Windows. We don't ship code-signing certificates because:

- Apple Developer Program: $99 / year — out of scope for an early release.
- Windows EV certificates: $200–$500 / year, plus USB token logistics.

The audience for this app — developers building MCP integrations — handles unsigned binaries routinely. The trade-off is a one-time `xattr` command on macOS and a "More info → Run anyway" click on Windows.

**Future plans**:
- **Windows**: [SignPath.io Foundation](https://signpath.io/product/open-source) offers free code signing for OSS projects. We'll evaluate this once SmartScreen friction becomes a recurring complaint.
- **macOS**: notarization via the Apple Developer Program when broader distribution is needed.

---

## Compared to the npm package

| | Tray app | `obsidian-vaultgate-mcp` (npm) |
|---|----------|---------------------------------|
| Install | Drag-and-drop / installer | `npm install -g …` |
| UI | Menu bar / system tray | None (CLI only) |
| Autostart | Toggle in tray menu | Manual via launchd / systemd / Task Scheduler |
| Smart Search model | Pre-bundled (offline) | Downloaded on first use |
| Updates | Manual download from GitHub releases | `npm update -g obsidian-vaultgate-mcp` |
| Linux | ❌ | ✅ |
| Bundle size | ~150 MB | ~ 6 MB + lazily-loaded model |
| Best for | Day-to-day use, semi-technical users | Headless servers, Claude Code via stdio, Linux, scripting |

You can mix the two: stop the tray app (or quit it), then run the npm package on the same machine — they don't fight as long as they don't bind the same port.

---

## Contributing / building from source

See [docs/TRAY-DEV.md](../docs/TRAY-DEV.md) for the developer guide: dev mode, build pipeline, packaging, CI, and how the tray app talks to the bundled server through `utilityProcess.fork()`.

---

## License

GPL-3.0-or-later. Same as the rest of the project. See [LICENSE](../LICENSE).
