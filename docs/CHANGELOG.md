# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Both distributions — the headless npm package (`server/`) and the Electron tray companion
(`tray/`) — share a single version line. Each release entry groups changes by distribution.
A section may be absent if that distribution had no changes in the release.

## [Unreleased]

### Server

#### Added

- Configurable conventions filename via `OBSIDIAN_CONTEXT_FILE` (default `VAULTGATE.md`). Point it at an existing file such as `CLAUDE.md` to reuse it. Must be a bare `.md` filename in the vault root — path separators and `..` are rejected at startup.

#### Security

- Bumped transitive `fast-uri` 3.1.2 → 3.1.4 (via `@modelcontextprotocol/sdk` → `ajv`) to clear the high-severity host-confusion advisories GHSA-4c8g-83qw-93j6 / GHSA-v2hh-gcrm-f6hx that were failing the CI audit gate.

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
- Semantic search tools: `index_vault`, `semantic_search`, `find_similar`, `index_status`, `clear_index`
- DNS rebinding protection (origin allowlist)
- All write tools default `dryRun: true`
