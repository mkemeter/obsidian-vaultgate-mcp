# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Both distributions — the headless npm package (`server/`) and the Electron tray companion
(`tray/`) — share a single version line. Each release entry groups changes by distribution.
A section may be absent if that distribution had no changes in the release.

## [0.2.6] — 2026-08-18

### Server

#### Changed

- **Semantic embedding model switched from `Xenova/bge-small-en-v1.5` to `Xenova/all-MiniLM-L6-v2`.**
  `all-MiniLM-L6-v2` (Microsoft Research / SBERT) is ~33% smaller (~23 MB vs ~34 MB) and faster.
  Both models produce 384-dim L2-normalised vectors; the embedding call, similarity math, and all
  tool interfaces are unchanged.
  `DEFAULT_MIN_SCORE` is lowered from `0.25` to `0.20` to compensate for MiniLM's slightly lower
  absolute similarity scores relative to BGE's retrieval-optimised training.
  **Index cache version bumped to 3** — existing embedding caches are automatically discarded and
  rebuilt on first run after the update. Searches return "being indexed" during the rebuild window.

### Tray

#### Changed

- Pre-bundled embedding model updated from `Xenova/bge-small-en-v1.5` to `Xenova/all-MiniLM-L6-v2`
  (see server entry above). DMG size decreases by ~11 MB.

#### Fixed

- **Smart search tray label shows the correct indexed-note count.** Two bugs combined to display
  the wrong number. (1) Notes whose content is empty after cleaning (blank files, frontmatter-only)
  were never stored in the index, so every sync treated them as new and re-embedded them —
  emitting spurious progress events. (2) Those progress events carried a `filesProcessed` field
  that the tray's event-merge overwrote the authoritative `filesProcessed` total from the last
  "ready" event, leaving the tray permanently showing the empty-note count instead of the real
  indexed total. Fix: empty-chunk notes are now stored (using their real content hash so they
  re-embed correctly if content is added later); a dedicated `totalIndexed` field on ready events
  carries the searchable note count and is never touched by progress events; and an incremental
  ready event is emitted after a search-time sync detects new notes, so the count refreshes
  without requiring a restart.

## [0.2.5] — 2026-08-14

### Server

#### Fixed

- **Semantic index no longer wiped on startup when Obsidian is not yet ready.** The tray app
  starts faster than Obsidian on most machines; if the CLI returned an empty file list before
  the plugin finished initialising, the prune loop deleted every entry from the in-memory index
  and `saveIndex` wrote `{ "files": {} }` to disk. Every subsequent restart re-hit the same
  race, causing "Smart search ready — 0 notes" to persist indefinitely. The fix skips
  `saveIndex` when a previously non-empty index receives an empty file list, reloads the
  good on-disk state, and retries after 60 s (up to 3 attempts). After 3 consecutive empty
  results the empty state is accepted as genuine (e.g. the user deleted all their notes).
- The same empty-list guard was added to `fullReHash`, which runs on the 24 h periodic
  re-hash cycle and when the tray "Rebuild index" button is pressed. Previously it had the
  same prune loop and could silently wipe the index if Obsidian was unreachable at that moment.
- Semantic search no longer tries to embed Obsidian's CLI update-check line (e.g.
  `2026-08-05 07:21:27 Checking for update using obsidian.md`) as a note. Such lines could
  leak onto the CLI's stdout and, because they end in `.md`, were mistaken for a vault path.
- The test suite no longer writes embeddings into the real user cache
  (`~/.cache/obsidian-vaultgate-mcp/`). The index cache directory is now resolvable via an
  internal `VAULTGATE_INDEX_CACHE_DIR` override, which the tests point at a throwaway
  per-worker directory.

### Tray

#### Added

- **Index controls in the tray menu.** Hover over the Smart search status row to reveal a
  submenu with two actions:
  - **Rebuild index** — soft refresh: re-embeds new and changed notes without taking the index
    offline. The status row stays "Smart search ready" throughout; searches keep working.
  - **Clear cache & rebuild** — hard reset: deletes the on-disk embeddings file and rebuilds
    from scratch. Use this if the index is believed corrupt. Searches show "building" until
    the rebuild completes.
  Both buttons are disabled (greyed out) while a build is already in progress.

## [0.2.4] — 2026-08-04

### Server

#### Changed

- Obsidian CLI runtime errors now append actionable guidance (Settings → General → Command line interface → Register CLI) while preserving Obsidian's own stderr, so an unregistered-CLI failure no longer surfaces as an opaque passthrough.

#### Security

- Raised the `@modelcontextprotocol/sdk` floor to `>=1.30.0` and refreshed the lockfile, pulling patched transitive dependencies (`@hono/node-server`, `hono`, `fast-uri`, `ip-address`) that cleared five npm audit advisories. VaultGate binds to `127.0.0.1` only and does not exercise the affected network-facing code paths, so real-world exposure was minimal.

### Tray

#### Fixed

- The Gatekeeper unquarantine command in the DMG background, `INSTALL.txt`, and the README now uses the absolute path `/usr/bin/xattr -rd …`. The previous `xattr -r -d …` failed with `option -r not recognized` for users who had a Python `xattr` (PyPI/Homebrew/conda) shadowing Apple's tool on their PATH — that variant has no `-r` flag.

## [0.2.3] — 2026-07-30

### Server

#### Added

- Shell-agnostic auto-start commands `obsidian-vaultgate-mcp-install` and `obsidian-vaultgate-mcp-uninstall`. They run the platform's deploy script (launchd / systemd / Task Scheduler) directly, so setup no longer requires the PowerShell-only `$(npm root -g)\...` invocation — the same command works verbatim in any shell on macOS, Linux, and Windows. Windows users no longer need to know to use PowerShell instead of Command Prompt.

#### Changed

- Auto-start and uninstall docs now use the new commands across the README and the launchd/systemd/example guides, replacing the per-platform `bash "$(npm root -g)/..."` / `powershell -ExecutionPolicy Bypass -File` commands.

## [0.2.2] — 2026-07-22

### Server

#### Added

- Configurable conventions filename via `OBSIDIAN_CONTEXT_FILE` (default `VAULTGATE.md`). Point it at an existing file such as `CLAUDE.md` to reuse it. Must be a bare `.md` filename in the vault root — path separators and `..` are rejected at startup.

#### Security

- Bumped transitive `fast-uri` 3.1.2 → 3.1.4 (via `@modelcontextprotocol/sdk` → `ajv`) to clear the high-severity host-confusion advisories GHSA-4c8g-83qw-93j6 / GHSA-v2hh-gcrm-f6hx that were failing the CI audit gate.

#### Fixed

- Windows installer (`deploy/install.ps1`) now detects the standard per-user install location `%LOCALAPPDATA%\Programs\Obsidian\Obsidian.exe` (plus fallbacks) and validates the resolved/entered path is a file, so `start.cmd` can no longer be written with a directory path. The startup health check also rejects an `OBSIDIAN_CLI_PATH` that points at a directory, with an actionable message instead of a later opaque `ENOENT` (#11).

### Tray

#### Added

- **Conventions file** field in Preferences to set the conventions filename (default `VAULTGATE.md`); changing it restarts the bundled server so the new file takes effect.

## [0.2.1] — 2026-06-23

### Tray

#### Fixed

- DMG background image now renders correctly on Apple Silicon (APFS) — switched from electron-builder to create-dmg (HFS+) to fix silent background failure
- Added drag-to-Applications instruction overlay and `xattr` fix guidance for the macOS 15+ "damaged app" Gatekeeper error
- Added `INSTALL.txt` inside the DMG with a copyable `xattr -cr` command for users who encounter Gatekeeper quarantine

## [0.2.0] — 2026-06-18

### Server

#### Added

- Biome 2.x lint + format enforcement in CI
- TypeScript stricter compiler options (`noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `allowUnreachableCode`, `allowUnusedLabels`)
- knip dead-code detection in CI
- CodeQL static analysis workflow
- Dependabot for npm and GitHub Actions
- CI restructured with dedicated `lint`, `audit`, `test`, and `ci-passed` jobs
- `.editorconfig` for consistent editor defaults
- Graceful HTTP shutdown: `startHttp()` installs `SIGTERM`/`SIGINT` handlers that drain in-flight connections before exit (5 s safety timeout)
- `VAULTGATE_MODEL_CACHE_DIR` env var: points `@xenova/transformers` at a pre-populated HuggingFace cache directory and disables remote downloads
- Internal `emitProgress()` IPC: when running under Electron `utilityProcess.fork()`, semantic-index state and per-file progress are forwarded to the parent via `process.parentPort.postMessage`
- `index_vault` now accepts a `dryRun` parameter (default `true`, consistent with all other management tools) — preview re-index scope without executing

#### Fixed

- `files_read` with `file=""` or `path=""` now returns `isError: true` instead of silently resolving to the active file
- Eager server creation in HTTP mode: `createServer()` is called at `startHttp()` startup so `startBackgroundIndex()` begins immediately, fixing stale vault stats displayed in the tray on startup
- Semantic index: reset to idle and retry after a build failure instead of staying stuck in a non-ready state
- `vault_context` / `vault_context_set`: MCP session preserved across vault changes; Smart Search note count reflects the correct vault immediately after switch

### Tray

#### Added

- Initial release of the Electron menu-bar companion app for macOS (Apple Silicon)
- Pre-bundled embedding model — Smart Search works offline on first launch with no download
- Auto-detection of Obsidian binary and registered vaults (parses `obsidian.json`)
- Native autostart toggle (in Preferences), port + vault preferences, rotating logs
- Three-zone context menu with branded header and index progress display
- Gem silhouette menu-bar icon

## [0.1.4] — 2026-06-15

### Server

#### Fixed

- `vault_context` tool description updated to prompt the LLM to call it at session start, improving first-response relevance

## [0.1.3] — 2026-06-15

### Server

#### Added

- Vault switch detection in semantic index: if >50% of indexed files disappear and new files arrive, index is wiped and rebuilt automatically

#### Fixed

- `tasks_pending` used wrong CLI filter flag — now correctly returns only incomplete tasks
- VAULTGATE.md CLI call deferred to client `initialize` — Obsidian is not contacted at server startup, only when a client connects
- Pre-release security audit: hardened config validation and dependency hygiene

## [0.1.2] — 2026-05-22

### Server

#### Added

- GUI navigation pillar: `note_open`, `search_open`, `daily_open` — dispatch `obsidian://` URIs via OS launcher
- Per-section embeddings for semantic search (INDEX_VERSION 2) — H1/H2/H3 boundary splitting, max-score retrieval, H3 parent context injection, date heading stripping
- `vault_context` and `vault_context_set` tools for reading and updating vault conventions
- `note_prepend`, `note_update`, `note_trash` write tools
- Favicon (ICO) and SVG icon served over HTTP
- Linux systemd install script
- macOS/Linux uninstall scripts
- npm publish workflow with OIDC Trusted Publishing (provenance)

#### Fixed

- Accept string-serialised booleans and numbers from MCP clients (`"true"` → `true`, `"1"` → `1`)
- CI Node version updated to 24 for npm >=11.5.1 compatibility

## [0.1.1] — 2025-12-01

### Server

#### Added

- Initial public release
- stdio and HTTP (Streamable + SSE) transports
- Core note tools: `note_read`, `note_create`, `note_append`, `note_delete`
- Search tools: `vault_search`, `tag_list`
- Daily note tools: `daily_read`, `daily_append`
- Template tools: `template_list`, `template_create_note`
- Plugin tools: `plugin_list`, `plugin_enable`, `plugin_disable`
- Semantic search tools: `index_vault`, `semantic_search`, `find_similar`, `vault_info`, `clear_index`
- DNS rebinding protection (origin allowlist)
- All write tools default `dryRun: true`
