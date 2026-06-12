# CLAUDE.md — obsidian-vaultgate-mcp

## Project summary

Local MCP server that exposes the official Obsidian CLI as individual MCP tools.
No community plugins required. Note content never leaves the machine.

- **Product name:** VaultGate
- **Package name:** `obsidian-vaultgate-mcp` (npm, binary, file paths)
- **License:** GPL-3.0-or-later (copyleft, share-alike — chosen deliberately)
- **Entry point:** `src/index.ts` → `build/index.js`
- **GitHub:** `https://github.com/mkemeter/obsidian-vaultgate-mcp`

---

## Naming convention

**VaultGate** is the product name — use it in prose, headings, and user-facing descriptions.
**`obsidian-vaultgate-mcp`** is the technical name — use it for npm commands, binary invocations, config JSON, file paths, and plist labels.

---

## User preferences

- **Do not mention Joule Work Desktop** — product is not yet released.
- **No competitor comparison tables** — keep the tone humble and factual.
- **Never touch `~/.claude/settings.json`** — the MCP server is consumed via HTTP from Joule Work Desktop, not from Claude Code. The URL is already configured there. Do not add, modify, or read the Claude Code MCP config.
- **Do not commit without being asked.**

---

## Tech stack

- TypeScript, ES2022, Node16 module resolution (`.js` extensions required on imports)
- `@modelcontextprotocol/sdk` ≥ 1.10.0
- `@xenova/transformers` — optional dependency for semantic search
- `@biomejs/biome` ≥ 2.4.0 — linter + formatter (single tool for lint + format)
- `knip` — dead code / unused dependency detection
- Vitest + `@vitest/coverage-v8` for tests (never Jest)
- No shell `exec` — always `execFile` with args as array

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript → `build/` |
| `npm test` | Run full test suite |
| `npm run test:coverage` | Tests + coverage report |
| `npm run check` | Biome lint + format check (CI-equivalent) |
| `npm run lint:fix` | Auto-fix Biome lint violations |
| `npm run format` | Auto-format with Biome |
| `npm run typecheck` | Type-check without building |
| `npm run knip` | Dead-code check locally |

---

## Architecture

**Transport detection** (`src/index.ts`): `process.stdin.isTTY === false` → stdio (Claude Code); TTY → HTTP mode.

**HTTP routes:**
- `POST /mcp` — Streamable HTTP (modern, MCP spec 2025-03-26)
- `GET /sse` — SSE legacy transport
- `POST /messages?sessionId=X` — SSE message delivery
- `GET /health` — liveness probe
- `GET /icon.svg` — SVG icon served for MCP clients
- `GET /favicon.ico` — ICO icon (16×16 and 32×32, programmatically generated)

**All CLI calls** go through `runObsidian()` in `src/cli.ts`. Vault prefix (`vault=<name>`) is prepended automatically when `OBSIDIAN_VAULT` is set.

**URI pillar:** `src/tools/uri.ts` (3 tools) calls `runUri()` in `src/uri.ts`. Dispatches `obsidian://` URIs via `openUri()` → `execFile(open|xdg-open|cmd)` by platform. Navigation only — no vault data changes, no `dryRun`. `openUri` is exported separately for testability (tools mock `runUri`; `uri.test.ts` mocks `execFile`).

**dryRun pattern:** Destructive tools default to `dryRun: true`. They call `dryRunPreview()` and return without touching the CLI. `dryRun: false` executes.

**Tool registration:** Each group is a `register*Tools(server)` function in `src/tools/*.ts`, all wired in `src/server.ts`. `BASE_TOOL_COUNT = 34` (base tools) and `SEMANTIC_TOOL_COUNT = 5` (optional semantic tools) must be kept in sync — the integration test asserts actual count equals one or the sum of both.

**Icon serving:** `src/server.ts` exports `getIconSvg()`, `getIconDataUri()`, and `getFaviconIco()`. The build script copies `src/icon.svg` and `src/favicon.ico` to `build/`. Both must exist in `build/` at runtime.

**`createServer()` is async** — required for the conditional `@xenova/transformers` import. All callers must `await createServer()`.

---

## CI structure

Three jobs: `lint` (Biome + typecheck + knip, Node 20), `audit` (npm audit, Node 20), `test` (build + coverage, Node 18/20/22 matrix). `ci-passed` aggregation job for branch protection — use this single check in branch protection rules, not per-matrix job names. Separate `publish.yml` triggers on GitHub releases (`release: types: [published]`) and supports manual dispatch.

---

## Documentation coverage

JSDoc documentation is enforced by convention (not tooling). This CLAUDE.md mandates "JSDoc on every export" and PRs are reviewed against this standard. Biome 2.x has no JSDoc enforcement rules; adding ESLint alongside Biome for this purpose is not justified for this project's scale. Exports without docs should be caught in code review.

Future option if the project grows a stable public API surface: add TypeDoc generation as an informational CI step.

---

## Security invariants (verified by audit)

- **Host is hardcoded:** `config.host` is typed `readonly "127.0.0.1"` — not user-configurable, never reads `OBSIDIAN_MCP_HOST`. Do not add an env var for this.
- **DNS rebinding protection:** Origin header checked against allowlist (`http://localhost`, `http://127.0.0.1` with/without port) — 403 for anything else.
- **No network calls in src/:** Zero `fetch`, `http.request`, `https.request` in source. Vault content never leaves the process.
- **All write tools default `dryRun: true`:** Enforced on all 11 destructive tools. Never change this default.
- **Semantic search:** Note content stays local. `@xenova/transformers` downloads the ONNX model (~100 MB) from Hugging Face on first use — this is the only external network call, and it is model-only.

---

## Known gotchas

### `promisify.custom` symbol in `cli.test.ts`
The real `execFile` has `[util.promisify.custom]`, so `promisify(execFile)` returns `{ stdout, stderr }`. A plain `vi.fn()` mock does **not** have this symbol — `promisify` falls back to standard callback wrapping and resolves to just the first arg (a string). The `const { stdout }` destructure then yields `undefined`, which silently throws in the catch block and produces confusing errors.

**Fix:** The mock in `cli.test.ts` uses a hand-crafted `fakeExecFile` with `[promisify.custom]` defined explicitly.

### `McpServer` internal handler access
SDK v1.29.0: `McpServer` is a high-level wrapper. `_requestHandlers` lives on the **inner** `Server` instance: `server.server._requestHandlers`, not `server._requestHandlers`.

### Config singleton loaded at import time
`config.ts` exports `const config = loadConfig()` evaluated immediately. To test with different env vars, use `vi.resetModules()` + `vi.doMock()` before a dynamic `import()`.

### Module-level singleton state in `semantic.ts`
`indexState`, `isReHashing`, `lastFullReHash`, `embedderInstance` are module-level. Use `vi.resetModules()` + dynamic `import()` in `beforeEach` for tests that depend on `indexState`.

### `vi.mock` vs `vi.doMock` in semantic tests
`vi.mock(...)` calls are **hoisted** to file-top at parse time — all `vi.mock` calls across the file are evaluated once, and the last one for a given module wins. Tests that need a *different* mock (e.g. per-input embedder `texts.map(() => FAKE_VEC_A)` for multi-section notes) must use `vi.doMock(...)` instead, which runs inline and is not hoisted. Tests that need the server to start with no existing cache (to stay in "building" state) must also use `vi.doMock` so the vault name can be set to a unique value at runtime via `freshModuleNoCache()`.

### Cache-first startup in `semantic.ts`
`startBackgroundIndex()` checks `Object.keys(idx.files).length > 0` after `loadIndex()`. If a cache exists, the server goes to `"ready"` immediately without calling the CLI — `syncNewAndDeleted()` runs on the first search call instead. Tests that expect `"building"` state must ensure no cache file exists on disk for the vault name they use (see `freshModuleNoCache()` in `semantic.test.ts`).

### `process.platform` mock in `uri.test.ts`
`process.platform` is a string property, not a function — `vi.spyOn` does not work on it. Mock with `Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })` and restore in `afterEach`. The same `fakeExecFile` with `[promisify.custom]` pattern from `cli.test.ts` is required here too.

### `mockReset()` vs `vi.resetAllMocks()` in tool tests
In tool tests that mock a module function and use `beforeEach`, use `vi.resetAllMocks()` instead of `mockFn.mockReset()`. Using `mockReset()` alone can cause Vitest's unhandled rejection tracking to misfire: when `mockRejectedValue` is set after a `mockReset()`, the subsequent rejection from the mock propagates as an unhandled rejection even though the tool handler has a `try/catch`. `vi.resetAllMocks()` properly resets the global rejection tracking state. Pattern: `beforeEach(() => vi.resetAllMocks())`.

---

## Coverage thresholds (vitest.config.ts)

| Metric | Threshold |
|--------|-----------|
| Lines | 90% |
| Functions | 90% |
| Branches | 85% |

Most common gap: uncovered `catch` blocks. Every tool needs an `isError` test (`mockRun.mockRejectedValue(...)`).

---

## Adding a tool

1. Implement in the appropriate `src/tools/*.ts` using the read-only or destructive pattern.
2. Increment `BASE_TOOL_COUNT` (or `SEMANTIC_TOOL_COUNT` for semantic tools) in `src/server.ts`.
3. Add unit tests: happy path + error path + (if destructive) dryRun true/false.
4. Update the tools overview table in `README.md`.
5. Update the relevant section in `README.md` (e.g. the Semantic search section for semantic tools).

See `docs/CONTRIBUTING.md` for the full step-by-step guide and test skeleton.

---

## Documentation hygiene

Every change must keep all four documentation layers in sync:

### Code documentation (`src/`)
- Tool `description` strings are user-facing and AI-facing — write them precisely. For destructive or easily misused tools, include explicit DO NOT guidance (e.g. `clear_index` warns not to use it before `index_vault`).
- Non-obvious logic warrants an inline comment. Trivial code does not.

### Developer documentation (`CLAUDE.md`, `CONTRIBUTING.md`)
- `CLAUDE.md`: update constants (`BASE_TOOL_COUNT`, `SEMANTIC_TOOL_COUNT`), architecture notes, and known gotchas whenever they change.
- `docs/CONTRIBUTING.md`: update the step-by-step guide if the contribution workflow changes.

### User documentation (`README.md`)
- Tools overview table — add a row for every new tool.
- Feature sections — update counts, descriptions, and behavioural notes when tools are added or changed.
- Troubleshooting section — add an entry for any new failure mode a user might encounter.

### Test coverage
- Thresholds: lines ≥ 90 %, functions ≥ 90 %, branches ≥ 85 % (enforced by `vitest.config.ts`).
- Every tool needs: happy path + `isError` path (`mockRun.mockRejectedValue(...)`).
- Every destructive tool additionally needs: dryRun true (no side effects) + dryRun false (executes).
- Run `npm test` and confirm all thresholds pass before considering a change complete.

---

## Pending before publish

- Set `"author"` in `package.json`
- Replace `YOUR_USERNAME` in `docs/CONTRIBUTING.md` clone URL
