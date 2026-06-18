# Contributing to VaultGate

Thank you for your interest in contributing. This document covers the project
architecture, development workflow, and conventions for both distributions:
the headless npm package (`server/`) and the Electron tray companion (`tray/`).

End-user documentation lives in [README.md](../README.md).

---

## Table of Contents

- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Architecture overview — server core](#architecture-overview--server-core)
  - [Transport detection](#transport-detection)
  - [HTTP routing](#http-routing)
  - [CLI invocation](#cli-invocation)
  - [dryRun consent mechanism](#dryrun-consent-mechanism)
- [Adding a new tool](#adding-a-new-tool)
- [Testing — server package](#testing--server-package)
  - [Running tests](#running-tests)
  - [Test structure](#test-structure)
  - [Writing unit tests for a tool](#writing-unit-tests-for-a-tool)
  - [Mocking the CLI](#mocking-the-cli)
  - [Coverage thresholds](#coverage-thresholds)
- [Code style](#code-style)
- [Pull request checklist](#pull-request-checklist)
- [Tray Companion App — developer guide](#tray-companion-app--developer-guide)
  - [What the tray app is](#what-the-tray-app-is)
  - [Branch strategy](#branch-strategy)
  - [Dev setup](#dev-setup)
  - [Architecture in detail](#architecture-in-detail)
  - [Testing patterns](#testing-patterns)
  - [Common dev tasks](#common-dev-tasks)
  - [Debugging guide](#debugging-guide)

---

## Development setup

This repository contains two distributions: the npm package under [`server/`](../server/) and the
Electron tray companion under [`tray/`](../tray/). Each has its own `package.json`. There is no
root-level `package.json` — `cd` into the directory you are working on.

```bash
git clone https://github.com/mkemeter/obsidian-vaultgate-mcp.git
cd obsidian-vaultgate-mcp/server   # or tray/
npm install
npm run build
npm test
```

### Development scripts (run inside `server/` or `tray/`)

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript → `build/` (server) or `dist/` (tray) |
| `npm test` | Run full test suite |
| `npm run test:coverage` | Tests + coverage report |
| `npm run check` | Biome lint + format check (CI-equivalent) — server only |
| `npm run lint:fix` | Auto-fix Biome lint violations — server only |
| `npm run format` | Auto-format source files — server only |
| `npm run typecheck` | Type-check without building |
| `npm run knip` | Dead-code check locally — server only |

You do **not** need Obsidian installed to develop or run tests — the test suite mocks the CLI binary entirely.

---

## Project structure

### Server package (`server/`)

```
server/
├── src/
│   ├── index.ts          Entry point — detects stdio vs HTTP mode, starts transport
│   ├── server.ts         Creates McpServer and registers all tool groups
│   ├── config.ts         Loads env vars (OBSIDIAN_VAULT, OBSIDIAN_CLI_PATH, OBSIDIAN_MCP_PORT)
│   ├── cli.ts            runObsidian() — the single point of contact with the CLI binary
│   ├── health.ts         Startup check — verifies the binary is reachable before serving
│   ├── uri.ts            openUri() / runUri() — OS-level URI dispatch (obsidian:// links)
│   └── tools/
│       ├── _helpers.ts   Shared utilities: dryRunPreview(), buildFileArgs()
│       ├── files.ts      files_list, files_read, note_create, note_append,
│       │                 note_prepend, note_update, note_trash
│       ├── search.ts     search
│       ├── daily.ts      daily_read, daily_append
│       ├── tasks.ts      tasks_all, tasks_pending, tasks_daily
│       ├── templates.ts  templates_list, templates_apply
│       ├── properties.ts property_read, property_set
│       ├── tags.ts       tags, backlinks, unresolved
│       ├── plugins.ts    plugins_list, plugin_reload
│       ├── dev.ts        eval, dev_errors, dev_console, dev_css, dev_dom,
│       │                 dev_screenshot, dev_mobile
│       ├── context.ts    vault_context, vault_context_set
│       ├── uri.ts        note_open, search_open, daily_open
│       └── semantic.ts   semantic_search, find_similar, index_vault,
│                         clear_index, vault_info  (optional — requires @xenova/transformers)
│
└── tests/
    ├── unit/
    │   ├── cli.test.ts
    │   ├── config.test.ts
    │   ├── health.test.ts
    │   └── tools/        one file per tool group, mirrors src/tools/
    └── integration/
        ├── http.test.ts   real HTTP server, origin validation, endpoint smoke tests
        └── server.test.ts tool registration count, all tools have names/descriptions
```

### Tray companion (`tray/`)

See [Tray Companion App — developer guide](#tray-companion-app--developer-guide) below for the full layout and architecture.

---

## Architecture overview — server core

### Transport detection

`src/index.ts` decides the run mode at startup by inspecting `process.stdin.isTTY`:

```
stdin is a pipe (not a TTY)  →  stdio mode   (used by Claude Code)
stdin is a TTY               →  HTTP mode    (used by any URL-based MCP client)
```

In **stdio mode** the process communicates over stdin/stdout using
`StdioServerTransport`. Claude Code manages the process lifecycle.

In **HTTP mode** a Node.js HTTP server listens on `127.0.0.1:<PORT>` (default
`3001`). Two MCP transports are served simultaneously for compatibility:

| Route | Transport |
|-------|-----------|
| `POST /mcp` | Streamable HTTP — modern MCP spec (2025-03-26) |
| `GET /sse` | SSE — legacy transport, backward-compatible fallback |
| `POST /messages?sessionId=X` | SSE message delivery to an existing session |
| `GET /health` | Liveness probe — returns `200 OK` |

### HTTP routing

Each incoming HTTP request goes through:

1. **Origin check** (`isAllowedOrigin`) — rejects requests whose `Origin`
   header is not `localhost` or `127.0.0.1`. This is the DNS rebinding
   protection layer. Requests with no `Origin` (e.g. CLI `curl`) are allowed.

2. **CORS headers** — set on responses when a recognised `Origin` is present.

3. **Route dispatch** — matched on `(method, pathname)`.

SSE sessions are held in a `Map<sessionId, SSEServerTransport>` for the
lifetime of the HTTP server. Each `GET /sse` creates a new entry; the entry is
deleted when the response closes.

Streamable HTTP creates a fresh `McpServer` + `StreamableHTTPServerTransport`
pair per request — the stateless design recommended by the MCP spec.

### CLI invocation

**All communication with Obsidian goes through `runObsidian()` in `src/cli.ts`.**

```typescript
runObsidian(["files", "list", "limit=20"])
// → execFile("obsidian", ["vault=My Vault", "files", "list", "limit=20"])
```

Key design decisions:

- **`execFile` not `exec`** — arguments are passed as an array and are never
  interpreted by a shell. Note names and content with shell metacharacters are
  safe.
- **Vault prefix** — when `OBSIDIAN_VAULT` is set, `vault=<name>` is
  prepended automatically so callers never need to think about it.
- **Timeout** — 30 seconds. Long enough for Obsidian to auto-start if it was
  not running; short enough to surface hangs quickly.
- **Max buffer** — 10 MB, sufficient for large vault listings or long notes.
- **ENOENT handling** — prints an actionable message pointing to the Obsidian
  CLI registration setting rather than a raw Node.js error.

### dryRun consent mechanism

All write/modify tools accept a `dryRun` parameter (boolean, **defaults to
`true`**).

- `dryRun: true` (default) — calls `dryRunPreview(args)` from `_helpers.ts`
  and returns immediately without touching the CLI. The preview shows the exact
  command that *would* run, including any vault prefix.
- `dryRun: false` — calls `runObsidian(args)` and returns the real output.

Tool descriptions instruct the AI assistant to always show the dry-run preview
and obtain explicit user confirmation before calling with `dryRun: false`.

The `eval` tool carries an extra warning because it executes arbitrary
JavaScript inside Obsidian:

> "This executes arbitrary JavaScript inside Obsidian. Always show dryRun
> preview and get explicit user confirmation. Never call with dryRun=false
> autonomously."

---

## Adding a new tool

### 1. Choose or create a tool file

If the tool fits an existing group (`files`, `search`, `daily`, …), add it
there. For a new group, create `src/tools/<group>.ts` and register it in
`src/server.ts`.

### 2. Implement the tool

Follow the pattern in any existing tool file. Required elements:

```typescript
server.tool(
  "tool_name",           // snake_case, unique across all tools
  "Description for the AI assistant.",
  {
    /* Zod schema for input parameters */
  },
  async (params) => {
    const args = ["cli-command", ...];

    // Destructive tools: gate on dryRun
    if (params.dryRun) {
      return { content: [{ type: "text", text: dryRunPreview(args) }] };
    }

    try {
      const output = await runObsidian(args);
      return { content: [{ type: "text", text: output }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: (error as Error).message }],
        isError: true,
      };
    }
  }
);
```

Rules:
- Read-only tools: no `dryRun` parameter, just try/catch around `runObsidian`.
- Destructive tools: include `dryRun: z.boolean().default(true)` and gate on
  it before calling the CLI.
- Always return `isError: true` in the catch block — never throw from a tool
  handler.
- Use `buildFileArgs(file, path)` from `_helpers.ts` whenever the tool targets
  a specific note.

### 3. Update `BASE_TOOL_COUNT` in `src/server.ts`

```typescript
export const BASE_TOOL_COUNT = 32; // was 31
```

The integration test `server.test.ts` asserts the actual registered tool count equals `BASE_TOOL_COUNT` (or `BASE_TOOL_COUNT + SEMANTIC_TOOL_COUNT` when `@xenova/transformers` is available) — it will fail if you forget to update it.

### 4. Add tests

See [Writing unit tests for a tool](#writing-unit-tests-for-a-tool) below.

---

## Testing — server package

### Running tests

```bash
npm test                 # run all tests once
npm run test:watch       # watch mode
npm run test:coverage    # run with coverage report (printed + lcov in coverage/)
```

### Test structure

```
tests/
├── unit/
│   ├── cli.test.ts          runObsidian(): success, error, ENOENT, vault prefix
│   ├── config.test.ts       env var loading, defaults, invalid port
│   ├── health.test.ts       binary found → passes, binary missing → exits
│   └── tools/
│       ├── files.test.ts    6 tools × (happy path + error path + dryRun)
│       └── ...              one file per tool group, same pattern
└── integration/
    ├── http.test.ts         /health, Origin → 403, /mcp, /sse, unknown path → 404
    └── server.test.ts       tool registration count, all tools have names/descriptions
```

### Writing unit tests for a tool

Each tool test file follows the same skeleton:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerXxxTools } from "../../../src/tools/xxx.js";

// Mock the CLI — tests never invoke the real obsidian binary
vi.mock("../../../src/cli.js", () => ({ runObsidian: vi.fn() }));

const { runObsidian } = await import("../../../src/cli.js");
const mockRun = vi.mocked(runObsidian);

function makeServer() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerXxxTools(server);
  return server;
}

async function invoke(server: McpServer, toolName: string, args: Record<string, unknown>) {
  const handler = (server.server as any)._requestHandlers.get("tools/call");
  return await handler({ params: { name: toolName, arguments: args } }, {});
}

describe("xxx tools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRun.mockResolvedValue("mock output");
  });

  it("tool_name — returns CLI output", async () => {
    const result = await invoke(makeServer(), "tool_name", { param: "value" });
    expect(result.content[0].text).toBe("mock output");
    expect(mockRun).toHaveBeenCalledWith(["cli-command", "param=value"]);
  });

  it("tool_name — isError on CLI failure", async () => {
    mockRun.mockRejectedValue(new Error("CLI failed"));
    const result = await invoke(makeServer(), "tool_name", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("CLI failed");
  });

  // For destructive tools:
  it("tool_name — dryRun=true (default) returns preview without calling CLI", async () => {
    const result = await invoke(makeServer(), "tool_name", { dryRun: true });
    expect(result.content[0].text).toContain("[DRY RUN]");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("tool_name — dryRun=false calls CLI", async () => {
    const result = await invoke(makeServer(), "tool_name", { dryRun: false });
    expect(mockRun).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });
});
```

### Mocking the CLI

`vi.mock("../../../src/cli.js", () => ({ runObsidian: mockRun }))` replaces
the entire module. `mockRun` is a plain `vi.fn()` — use `.mockResolvedValue()`
for success and `.mockRejectedValue()` for the error path.

**The `promisify.custom` symbol** — relevant only to `cli.test.ts` itself. The
real `execFile` has `[util.promisify.custom]` so `promisify(execFile)` returns
`{ stdout, stderr }`. The mock in `cli.test.ts` replicates this:

```typescript
import { promisify } from "node:util";

const fakeExecFile = Object.assign(
  (_bin: string, _args: string[], _opts: object, _cb: Function) => {},
  {
    [promisify.custom]: (bin: string, args: string[], _opts: object) => {
      // store captured args, return a controllable Promise
    },
  }
);
vi.mock("node:child_process", () => ({ execFile: fakeExecFile }));
```

Do not try to mock `execFile` as a plain `vi.fn()` — it will silently break
the `const { stdout } = await execFileAsync(...)` destructure.

**Config re-loading in unit tests** — `config.ts` exports a singleton
`const config = loadConfig()` evaluated at import time. To test with a
different env, use:

```typescript
vi.resetModules();
vi.doMock("../../src/config.js", () => ({ config: { vault: "TestVault", ... } }));
const { runObsidian } = await import("../../src/cli.js");
```

### Coverage thresholds

Enforced in `vitest.config.ts` for both `server/` and `tray/`:

| Metric | Threshold |
|--------|-----------|
| Lines | 90% |
| Functions | 90% |
| Branches | 85% |

`npm run test:coverage` will exit non-zero if any threshold is not met.
The most common cause of coverage gaps is an uncovered `catch` block — add an
`isError` test for every tool.

---

## Code style

- **TypeScript strict mode** — `"strict": true` in `tsconfig.json`. No `any`
  unless casting through an explicit intermediate type.
- **ESM throughout** — `"type": "module"` in `package.json`. Import paths must
  include the `.js` extension (Node16 module resolution).
- **No shell exec** — always use `execFile`, never `exec` or template-literal
  shell strings.
- **JSDoc on every export** — include `@param` and `@returns` for non-obvious
  parameters. Inline comments for non-obvious logic only.
- **`isError: true`** on tool error returns — never throw from inside a tool
  handler.

---

## Pull request checklist

- [ ] `npm run build` compiles without errors or warnings
- [ ] `npm run check` passes (no lint or format violations)
- [ ] `npm run typecheck` passes (no type errors)
- [ ] `npm test` passes (all tests green)
- [ ] `npm run test:coverage` meets all three thresholds
- [ ] New tools have unit tests covering: happy path, CLI error path, and
      (if destructive) `dryRun: true` and `dryRun: false`
- [ ] `BASE_TOOL_COUNT` in `src/server.ts` updated if base tools were added or removed
- [ ] JSDoc added to all new exported symbols
- [ ] No hardcoded vault names, paths, or personal details

---

## Tray Companion App — developer guide

The repository also hosts an Electron tray companion app under [`tray/`](../tray/). It is **optional** — the headless npm package is the canonical distribution and remains releasable independently.

### What the tray app is

A small Electron 35 app that:

1. Forks the existing `obsidian-vaultgate-mcp` server as a child process via `utilityProcess.fork()`.
2. Renders a system-tray icon and context menu reflecting server state and the semantic-index lifecycle.
3. Exposes a Preferences window for vault / port / Obsidian-binary configuration.
4. Manages OS-level autostart via Electron's `app.setLoginItemSettings`.

It is **layered on top of** the npm package — the same `src/index.ts` runs inside the tray, spawned via `utilityProcess.fork()` instead of as a stdio child of an MCP client.

### Layout

```
tray/
├── src/
│   ├── main.ts              App entry. Single-instance lock, dock hide, startup orchestration.
│   ├── server-manager.ts    utilityProcess.fork() lifecycle, MessageChannel IPC, log rotation,
│   │                        crash restart, pre-flight checks.
│   ├── tray-menu.ts         Tray + Menu construction; full rebuild on every state change.
│   ├── prefs-window.ts      Preferences BrowserWindow lifecycle + prefs:* IPC handlers.
│   ├── preload.ts           contextBridge surface exposed to the prefs renderer.
│   ├── config-store.ts      JSON persistence + Obsidian-path / vault auto-detection.
│   ├── autostart.ts         macOS login-item toggle wrapper.
│   ├── auto-detect.ts       Pure functions for Obsidian binary and vault detection (fully tested).
│   └── tray-labels.ts       Pure functions for menu label generation (fully tested).
├── renderer/
│   ├── prefs.html           Preferences markup (CSP-locked, sandbox: true).
│   └── prefs.js             Renderer logic; talks to main exclusively via window.vaultgate.
├── scripts/
│   ├── download-models.js   Build-time pre-fetch of the embedding model into assets/models/.
│   └── copy-renderer.js     Copies renderer/ into dist/renderer/ during build.
├── assets/
│   ├── icon.png / icon@2x.png   Menu bar icons (22×22 / 44×44, template image on macOS).
│   ├── icon.svg                 Source SVG (also used as the macOS app icon).
│   └── models/                  Pre-downloaded embedding model — gitignored, populated by CI.
├── tests/unit/                  Vitest tests for non-Electron-bound modules.
├── electron-builder.yml         Packaging config (DMG arm64).
├── package.json                 Tray-only dependencies — no overlap with server/package.json.
├── tsconfig.json
└── vitest.config.ts             Test thresholds + Electron-bound exclusions.
```

The tray code never imports server sources directly. It depends on the **build output** of the server package (`server/build/index.js`), bundled into `dist/server/server.mjs` via esbuild during the tray's own build step.

### Branch strategy

All tray work lives on **`feature/tray-initial`**. `main` carries the headless-only npm package and is released independently.

- The tray app does **not** affect `npm publish` — the root `package.json` `"files"` allowlist excludes `tray/`.
- A separate CI workflow ([`.github/workflows/tray.yml`](../.github/workflows/tray.yml)) builds tray artifacts and is path-filtered to `tray/**` — it never blocks npm releases.
- Both `server/package.json` and `tray/package.json` always share the same version number. A single `v*` tag (e.g. `v0.2.0`) triggers both the npm publish workflow and the tray DMG release. Bump both together using the root `VERSION` file and `node scripts/sync-version.js`.
- A merge of the tray branch to `main` is a **separate, deliberate decision**. Until then, the tray branch lives alongside `main`. Keep `main` releasable. Don't merge speculatively.

### Dev setup

#### Prerequisites

- Node.js 20+
- A working install of Obsidian with the CLI registered (Obsidian → Settings → General → Register CLI)

#### First-time setup

```bash
# Build the server package first — the tray bundles it.
cd server
npm install
npm run build

# Then set up the tray.
cd ../tray
npm install
```

`@xenova/transformers` is a hard dependency for the tray app (the model is bundled, not fetched at runtime). Native addons (`onnxruntime-node`, `sharp`) are recompiled against Electron's Node ABI by `@electron/rebuild` automatically as a postinstall step.

Pre-fetch the embedding model into `assets/models/` (one-time, ~34 MB):

```bash
npm run download-models
```

The directory is gitignored; CI restores it from the actions cache, keyed on the model name.

#### Running locally

```bash
cd tray
npm run dev
```

This:

1. Re-builds the server package (`cd ../server && npm run build`).
2. Bundles the server into `dist/server/server.mjs` via esbuild (ESM, `onnxruntime-node` and `sharp` external).
3. Compiles the tray TypeScript into `dist/`.
4. Copies `renderer/` into `dist/renderer/`.
5. Launches Electron pointing at `dist/main.js`.

You should see a tray icon in the menu bar. Wait for `● Running — <vault>`.

#### Packaging

```bash
cd tray
npm run package        # builds + electron-builder for the host platform
```

Output lands in `tray/dist/VaultGate-X.Y.Z-mac-arm64.dmg`.

Builds are intentionally **per-host-arch**: `onnxruntime-node` only downloads the native binary for the host platform, so producing a universal macOS DMG requires a separate CI job per architecture.

#### Releasing

```bash
# 1. Edit root VERSION, then sync into both package.json files.
node scripts/sync-version.js

# 2. Commit, then tag.
git add VERSION server/package.json tray/package.json
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

This triggers `.github/workflows/tray.yml` which builds the macOS arm64 DMG and publishes to a GitHub release. `GITHUB_TOKEN` is the only secret required.

### Architecture in detail

#### Why `utilityProcess.fork()`, not `child_process.fork()`

`child_process.fork()` from inside a packaged Electron app uses Electron's own executable as the Node runtime. ASAR path resolution then breaks module loading inside the packaged app.

Electron's first-party answer is [`utilityProcess.fork()`](https://www.electronjs.org/docs/latest/api/utility-process), available since Electron 22. It handles ESM, IPC, packaged resource paths, and cross-platform invariants correctly.

#### Why `OBSIDIAN_MCP_TRANSPORT=http` is required

The server's transport detection in `src/index.ts` is:

```ts
if (transportEnv === "http" || (transportEnv !== "stdio" && process.stdin.isTTY))
```

Inside `utilityProcess.fork()`, `process.stdin.isTTY` is `undefined` — stdin is piped, not a TTY. Without an explicit `OBSIDIAN_MCP_TRANSPORT=http` the condition resolves falsy and the server binds **stdio**, never opening an HTTP listener. Every tool call from a client would then hang.

**Always set `OBSIDIAN_MCP_TRANSPORT: 'http'` in the fork env.** `server-manager.ts` enforces it.

#### IPC: `process.parentPort.postMessage`, not `process.send`

`utilityProcess` uses MessagePort-based IPC, **not** the Node.js `child_process` IPC channel. `process.send` is `undefined` in a utility process — semantic-index progress is forwarded via `process.parentPort.postMessage`.

The headless npm path leaves `process.parentPort` undefined, and the `emitProgress()` helper in `src/tools/semantic.ts` is a strict no-op there.

#### Pre-bundled model: `env.cacheDir`, not `env.localModelPath`

When the tray sets `VAULTGATE_MODEL_CACHE_DIR=<resourcesPath>/models`, the server points `@xenova/transformers` at the bundled cache directory and disables remote downloads (`VAULTGATE_ALLOW_REMOTE_MODELS=false`).

Use `env.cacheDir`, not `env.localModelPath`. The two APIs expect different directory structures:

| API | Layout |
|-----|--------|
| `env.cacheDir` | `models--Xenova--bge-small-en-v1.5/snapshots/<hash>/...` (HuggingFace snapshot format) |
| `env.localModelPath` | `Xenova/bge-small-en-v1.5/...` (flat layout) |

Mixing them causes a silent model-load failure. `tray/scripts/download-models.js` populates the cache in `env.cacheDir` format.

#### Native addon strategy

Three modules are native (`.node` binaries): `onnxruntime-node`, `sharp`, and `electron` itself. These cannot live inside the asar archive — `dlopen()` requires real filesystem paths. `electron-builder.yml` lists them in `asarUnpack`:

```yaml
asarUnpack:
  - "**/*.node"
  - "node_modules/onnxruntime-node/**"
  - "node_modules/sharp/**"
```

The full `node_modules/onnxruntime-node/**` glob is needed because `onnxruntime-node` ships multiple shared libraries alongside the `.node` file.

#### Server bundle (esbuild)

The server is bundled into a single ~17 MB ESM file rather than copied as a `node_modules` tree. This eliminates ~380 MB of `node_modules` from the build input, cuts the number of files macOS must individually codesign from thousands to one, and simplifies `extraResources` to a single entry.

`@xenova/transformers` (~15 MB JS) is included in the bundle. `onnxruntime-node` and `sharp` are marked external — they're resolved at runtime from `node_modules/` via asarUnpack.

### Testing patterns

Coverage thresholds for `tray/` are the same as `server/`: **lines ≥ 90%, functions ≥ 90%, branches ≥ 85%**.

Five files are excluded from coverage gating — each with a concrete justification, not a slack budget:

| Excluded file | Reason |
|---|---|
| `main.ts` | Sequential entry-point script (`requestSingleInstanceLock`, `dock.hide`, `app.whenReady` listener). Decision logic was extracted to `auto-detect.ts` and is fully tested. The remaining orchestration breaks visibly on first launch — caught by `npm run dev`. |
| `preload.ts` | `contextBridge.exposeInMainWorld` wiring. Each bridge property is `(args) => ipcRenderer.invoke('prefs:X', args)`. A test would only verify the channel name on each invoke — a tautology that locks the test to its implementation. |
| `prefs-window.ts` | Registers `ipcMain.handle` for 7 channels, each wrapping a function already tested by `config-store.test.ts` / `autostart.test.ts`. The marginal value of testing thin wrappers around tested code does not justify the mock surface. |
| `tray-menu.ts` | Pure label generators were extracted to `tray-labels.ts` and have full coverage. What remains is `new Tray(…)`, `Menu.buildFromTemplate`, and click handlers that delegate to other tested modules. Mocking Electron's `Menu`/`Tray` to assert on the items array would lock tests to the exact menu structure. |
| `server-manager.ts` | `utilityProcess.fork()` lifecycle + `MessageChannelMain` IPC + crash-restart timer. Mocking Electron's IPC accurately enough to exercise crash recovery requires an extensive mock surface that itself becomes a maintenance burden. The 11 unit tests in `server-manager.test.ts` cover the public state-machine surface (pre-flight failures, idempotent start, on/off subscription). The fork internals are verified via `npm run dev`. |

In every case, breakage is **immediately visible during dev mode**: tray icon doesn't appear, menu items missing, server doesn't start, prefs dialog won't open. The risk profile is "fails noisily in five seconds" rather than "silent regression in production".

Where logic was extractable into pure functions, it **was** extracted: `auto-detect.ts` (5 tests) and `tray-labels.ts` (23 tests) carry the full coverage burden for what would otherwise be uncovered behaviour.

#### ESM module mocking

Vitest cannot `vi.spyOn` namespace exports of ESM modules (`os.homedir`, etc.). Use a hoisted state object + `vi.mock` factory to override at module level:

```ts
const mockState = vi.hoisted(() => ({ fsExistsSync: undefined as ((p: unknown) => boolean) | undefined }));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: string) => (mockState.fsExistsSync ? mockState.fsExistsSync(p) : actual.existsSync(p)),
    default: actual,
  };
});

beforeEach(() => { mockState.fsExistsSync = undefined; });
```

The factory runs **once** per test file (hoisted before all tests). Per-test state goes through the mutable `mockState` object.

#### Cleanup ordering in `afterEach`

`config-store.test.ts` learned this the hard way: `afterEach` deleted a temp dir via `realFs.existsSync()` — but `realFs` was the *mocked* module, and a previous test had wired `existsSync` to throw. Reset mock overrides at the **top** of `afterEach`, before any cleanup that uses the same module.

> **Reporter quirk:** vitest 4.x's v8 text reporter hides files at 100% coverage even with `skipFull: false`. `autostart.ts` and `tray-labels.ts` are measured but won't appear in the per-file table. The summary numbers and `coverage/lcov.info` include them correctly.

### Common dev tasks

#### Adding a new menu item

Edit `tray/src/tray-menu.ts` → `buildMenu()`. The menu is fully rebuilt on every state change (Electron has no partial-update API), so push a new `MenuItemConstructorOptions` into the right section. State-conditional items go inside the `if (isRunning)` / `else` blocks.

If your item triggers a server change, call `void serverManager.restart()` from the click handler — it gracefully drains the old server before the new one starts.

#### Adding a new preference

1. Extend `VaultGateConfig` in `tray/src/config-store.ts`.
2. Add a default in the `DEFAULTS` object.
3. Add a form field in `tray/renderer/prefs.html`.
4. Wire it up in `tray/renderer/prefs.js`.
5. If the server needs to know about it, set the corresponding env var in `server-manager.ts` → `start()` → `utilityProcess.fork({ env })`.
6. Add a test for the new field's persistence in `tray/tests/unit/config-store.test.ts`.

#### Bumping the embedding model

`MODEL_ID` lives in `src/tools/semantic.ts`. After changing it:

1. Update `INDEX_VERSION` in the same file (forces re-embedding).
2. Update `tray/scripts/download-models.js` to match.
3. Bump the CI cache key in `.github/workflows/tray.yml` so old caches don't pollute new builds.

#### Forwarding a new server log line

`server-manager.ts` already pipes `proc.stdout` and `proc.stderr` into `vaultgate.log` and emits a `log` event. New consumers subscribe via `serverManager.on("log", listener)`.

### Debugging guide

| Symptom | First place to look |
|---------|---------------------|
| Tray icon never appears | macOS Console.app → filter "VaultGate" |
| Server says "stdio mode" in logs | `OBSIDIAN_MCP_TRANSPORT=http` env var missing on the fork — check `server-manager.ts` `start()` |
| Smart Search stays "warming up" forever | **Open Logs…** → look for `[server:err]` entries from `@xenova/transformers`; confirm `assets/models/` is populated |
| Build fails with "node_modules/.cache" mismatch | `cd tray && npx @electron/rebuild` to recompile native addons against the current Electron ABI |
| `utilityProcess.fork()` exits immediately with code 1 | Bundle is broken — check `dist/server/server.js` exists and `OBSIDIAN_CLI_PATH` resolves |
| Server health check fails on Windows | On Windows, `OBSIDIAN_CLI_PATH` must be set to the full path including `.exe` (e.g. `C:\...\obsidian.exe`). The default `"obsidian"` requires the binary to be on `PATH`. The installer (`server/deploy/install.ps1`) sets this automatically. |
| Coverage thresholds drop after a refactor | Inspect the file in the report. If it's genuinely Electron-bound, exclude it in `vitest.config.ts` with a comment explaining why |
