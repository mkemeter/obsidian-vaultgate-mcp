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
