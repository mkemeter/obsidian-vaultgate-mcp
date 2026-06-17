# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Biome 2.x lint + format enforcement in CI
- TypeScript stricter compiler options (`noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `allowUnreachableCode`, `allowUnusedLabels`)
- knip dead-code detection in CI
- CodeQL static analysis workflow
- Dependabot for npm and GitHub Actions
- CI restructured with dedicated `lint`, `audit`, `test`, and `ci-passed` jobs
- `.editorconfig` for consistent editor defaults
- Graceful HTTP shutdown: `startHttp()` now installs `SIGTERM` and `SIGINT` handlers that drain in-flight connections before exit (5 s safety timeout). Backwards-compatible with all existing distribution paths
- `VAULTGATE_MODEL_CACHE_DIR` env var: when set, points `@xenova/transformers` at a pre-populated HuggingFace cache directory and disables remote downloads. Used by the tray companion app to ship the embedding model offline. Unset = unchanged headless behaviour
- Internal `emitProgress()` IPC: when running under Electron `utilityProcess.fork()`, semantic-index state and per-file progress are forwarded to the parent process via `process.parentPort.postMessage`. No-op in plain Node

### Tray companion app (separate distribution channel)
- New Electron-based menu-bar companion app under [`tray/`](../tray/) for macOS (Apple Silicon)
- Pre-bundled embedding model — Smart Search works offline on first launch with no download
- Auto-detection of Obsidian binary and registered vaults (parses `obsidian.json`)
- Native autostart toggle (in Preferences), port + vault preferences, rotating logs
- Ships under the `tray/v*` git tag — independent of npm package releases
- Headless npm path is unaffected; root `package.json` `"files"` allowlist excludes `tray/`
- Documentation: [tray/README.md](../tray/README.md) (users), [docs/TRAY-DEV.md](TRAY-DEV.md) (contributors)

## [0.1.2] — 2026-05-22

### Added
- GUI navigation pillar: `note_open`, `search_open`, `daily_open` — dispatch `obsidian://` URIs via OS launcher
- Per-section embeddings for semantic search (INDEX_VERSION 2) — H1/H2/H3 boundary splitting, max-score retrieval, H3 parent context injection, date heading stripping
- `vault_context` and `vault_context_set` tools for per-session vault switching
- `note_prepend`, `note_update`, `note_trash` write tools
- Favicon (ICO) and SVG icon served over HTTP
- Linux systemd install script
- macOS/Linux uninstall scripts
- npm publish workflow with OIDC Trusted Publishing (provenance)

### Fixed
- Accept string-serialised booleans and numbers from MCP clients (`"true"` → `true`, `"1"` → `1`)
- CI Node version updated to 24 for npm >=11.5.1 compatibility

## [0.1.1] — 2025-12-01

### Added
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
