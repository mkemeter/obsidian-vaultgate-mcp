# Tray companion — developer guide

This document is for **contributors** working on the `tray/` directory. End-user install instructions live in [tray/README.md](../tray/README.md).

---

## What the tray app is

A small Electron 35 app that:

1. Forks the existing `obsidian-vaultgate-mcp` server as a child process.
2. Renders a system-tray icon and context menu reflecting server state and the semantic-index lifecycle.
3. Exposes a Preferences window for vault / port / Obsidian-binary configuration.
4. Manages OS-level autostart via Electron's `app.setLoginItemSettings` (configurable from Preferences).

It is **layered on top of** the npm package — the same `src/index.ts` runs inside the tray, just spawned via `utilityProcess.fork()` instead of as a stdio child of an MCP client.

---

## Layout

```
tray/
├── src/
│   ├── main.ts              App entry. Single-instance lock, dock hide, startup orchestration.
│   ├── server-manager.ts    utilityProcess.fork() lifecycle, MessageChannel IPC, log rotation,
│   │                        crash restart, pre-flight checks.
│   ├── tray-menu.ts         Tray + Menu construction; full rebuild on every state change.
│   ├── prefs-window.ts      Preferences BrowserWindow lifecycle + `prefs:*` IPC handlers.
│   ├── preload.ts           contextBridge surface exposed to the prefs renderer.
│   ├── config-store.ts      JSON persistence + Obsidian-path / vault auto-detection.
│   ├── autostart.ts         macOS login-item toggle wrapper.
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
├── package.json                 Tray-only dependencies — no overlap with root package.json.
├── tsconfig.json
└── vitest.config.ts             Test thresholds + Electron-bound exclusions.
```

The tray code never imports server sources directly. It depends on the **build output** of the server package (`server/build/index.js`), bundled into `dist/server/server.mjs` via esbuild during the tray's own build step. The bundle uses ESM format because the server's entry uses top-level await.

---

## Branch strategy

All tray work happens on **`feature/tray-initial`**. `main` carries the headless-only npm package and is released independently.

- The tray app does **not** affect `npm publish` — the root `package.json` `"files"` allowlist excludes `tray/`, so npm consumers never see it.
- A separate CI workflow ([`.github/workflows/tray.yml`](../.github/workflows/tray.yml)) builds tray artifacts and is path-filtered to `tray/**` only — it never blocks npm releases.
- A merge of the tray branch to `main` is a **separate, deliberate decision** made after the implementation is fully validated. Until then, the tray branch lives alongside `main`.

When in doubt: keep `main` releasable. Don't merge speculatively.

---

## Dev setup

### Prerequisites

- Node.js 20+ (matching root requirement)
- A working install of Obsidian (the tray app talks to the running instance)
- The Obsidian CLI registered (Obsidian → Settings → General → Register CLI)

### First-time setup

```bash
# Build the server package once.
cd server
npm install
npm run build

# Then in tray/
cd ../tray
npm install
```

`@xenova/transformers` is a hard dependency for the tray app (the model is bundled, not fetched at runtime). Native addons (`onnxruntime-node`, `sharp`) are recompiled against Electron's Node ABI by `@electron/rebuild` automatically as a postinstall step.

Pre-fetch the embedding model into `assets/models/` (one-time, ~34 MB):

```bash
npm run download-models
```

The directory is gitignored; CI restores it from the actions cache, keyed on the model name.

### Running locally

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

You should see a tray icon in the menu bar. The icon will reflect server state — wait for `● Running — <vault>`.

### Testing

```bash
cd tray
npm test               # vitest run
npm run test:watch     # interactive
npm run test:coverage  # coverage report against thresholds
npm run typecheck      # tsc --noEmit
```

Coverage thresholds: **lines ≥ 90 %, functions ≥ 90 %, branches ≥ 85 %** — the same bar as the root project.

Five files are excluded from coverage gating. Each exclusion is a deliberate trade-off, not a slack budget:

| Excluded file | Reason |
|---|---|
| `main.ts` | Sequential entry-point script (`requestSingleInstanceLock`, `dock.hide`, `app.whenReady` listener). Decision logic was extracted to [`auto-detect.ts`](../tray/src/auto-detect.ts) and is fully tested. The remaining orchestration breaks visibly on first launch — caught by `npm run dev`. |
| `preload.ts` | `contextBridge.exposeInMainWorld` wiring. Each bridge property is `(args) => ipcRenderer.invoke('prefs:X', args)`. A test would only verify the channel name on each invoke — a tautology that locks the test to its implementation. |
| `prefs-window.ts` | Registers `ipcMain.handle` for 7 channels, each wrapping a function already tested by `config-store.test.ts` / `autostart.test.ts`. `openPrefsWindow()` constructs a `BrowserWindow`. The marginal value of testing thin wrappers around tested code does not justify the mock surface. |
| `tray-menu.ts` | Pure label generators were extracted to [`tray-labels.ts`](../tray/src/tray-labels.ts) and have full coverage. What remains is `new Tray(…)`, `Menu.buildFromTemplate`, and click handlers that delegate to other tested modules. Mocking Electron's `Menu`/`Tray` to assert on the items array would lock tests to the exact menu structure — every menu reorder would break tests. |
| `server-manager.ts` | `utilityProcess.fork()` lifecycle + `MessageChannelMain` IPC + crash-restart timer logic + stdio piping. Mocking Electron's IPC accurately enough to exercise crash recovery and message-port semantics requires an extensive mock surface that itself becomes a maintenance burden — every Electron IPC contract change would mean updating mocks. The 11 unit tests in [`server-manager.test.ts`](../tray/tests/unit/server-manager.test.ts) cover the public state-machine surface (pre-flight failures, idempotent start, on() subscription) — the parts most likely to change. The fork-internals are stable Electron contract verified manually via `npm run dev`. |

In every case, breakage is **immediately visible during dev mode**: tray icon doesn't appear, menu items missing, server doesn't start, prefs dialog won't open. The risk profile is "fails noisily in five seconds" rather than "silent regression in production".

Where logic was extractable into pure functions, it **was** extracted: [`auto-detect.ts`](../tray/src/auto-detect.ts) (5 tests) and [`tray-labels.ts`](../tray/src/tray-labels.ts) (23 tests) carry the full coverage burden for what would otherwise be uncovered behaviour.

> **Reporter quirk:** vitest 4.x's v8 text reporter hides files at 100 % coverage even with `skipFull: false`. `autostart.ts` (5 tests, 100 % covered) and `tray-labels.ts` (23 tests, 100 % covered) are measured but won't appear in the per-file table. The summary numbers at the bottom of the report and the generated `coverage/lcov.info` include them.

### Packaging

```bash
cd tray
npm run package        # builds + electron-builder for the host platform
```

Output lands in `tray/dist/`:
- `VaultGate-X.Y.Z-mac-arm64.dmg` (when run on Apple Silicon)

Builds are intentionally **per-host-arch**: `onnxruntime-node`'s postinstall only downloads the native binary for the host platform, so producing a true universal macOS DMG requires a separate CI job per architecture (deferred to a later phase).

### Releasing

Tray releases use the `tray/v*` git tag prefix to keep them independent of npm releases. CI handles the actual upload:

```bash
git tag tray/v0.1.0
git push origin tray/v0.1.0
```

This triggers `.github/workflows/tray.yml` which builds the macOS arm64 DMG and publishes to a GitHub release. `GITHUB_TOKEN` is the only secret required.

---

## Architecture in detail

### Why `utilityProcess.fork()`, not `child_process.fork()`

`child_process.fork()` from inside a packaged Electron app uses Electron's own executable as the Node runtime, not a clean `node` binary. ASAR path resolution then breaks module loading inside the packaged app.

Electron's first-party answer is [`utilityProcess.fork()`](https://www.electronjs.org/docs/latest/api/utility-process), available since Electron 22. It's specifically designed for long-lived Node child processes inside packaged apps and handles ESM, IPC, packaged resource paths, and cross-platform invariants correctly.

### Why `OBSIDIAN_MCP_TRANSPORT=http` is required

The server's transport detection in `src/index.ts` is:

```ts
if (transportEnv === "http" || (transportEnv !== "stdio" && process.stdin.isTTY))
```

Inside `utilityProcess.fork()`, `process.stdin.isTTY` is `undefined` — stdin is piped, not a TTY. Without an explicit `OBSIDIAN_MCP_TRANSPORT=http` the condition resolves falsy and the server binds **stdio**, never opening an HTTP listener. Every tool call from a client would then hang.

**Always set `OBSIDIAN_MCP_TRANSPORT: 'http'` in the fork env.** The integration test `tests/integration/http.test.ts` documents this contract. `server-manager.ts` enforces it.

### IPC: `process.parentPort.postMessage`, not `process.send`

`utilityProcess` uses MessagePort-based IPC, **not** the Node.js `child_process` IPC channel. `process.send` is `undefined` in a utility process — so semantic-index progress is forwarded via `process.parentPort.postMessage`.

The headless npm path leaves `process.parentPort` undefined, and the `emitProgress()` helper in `src/tools/semantic.ts` is a strict no-op there. Tests in `tests/unit/tools/semantic.test.ts` (the `emitProgress — utilityProcess.fork() IPC` describe block) verify both paths.

### Pre-bundled model: `env.cacheDir`, not `env.localModelPath`

When the tray sets `VAULTGATE_MODEL_CACHE_DIR=<resourcesPath>/models`, the server points `@xenova/transformers` at the bundled cache directory **and** disables remote downloads (`VAULTGATE_ALLOW_REMOTE_MODELS=false`).

Use `env.cacheDir`, not `env.localModelPath`. The two APIs expect different directory structures:

| API | Layout |
|-----|--------|
| `env.cacheDir` | `models--Xenova--bge-small-en-v1.5/snapshots/<hash>/...` (HuggingFace snapshot format) |
| `env.localModelPath` | `Xenova/bge-small-en-v1.5/...` (flat layout) |

Mixing them causes a silent model-load failure. The `tray/scripts/download-models.js` script populates the cache in `env.cacheDir` format so the runtime layout matches.

### Native addon strategy

Three modules are native (`.node` binaries):

- `onnxruntime-node` — ML inference backend
- `sharp` — image processing (hard dep of `@xenova/transformers`)
- `electron` itself

These cannot live inside the asar archive — `dlopen()` requires real filesystem paths. `electron-builder.yml` lists them in `asarUnpack`:

```yaml
asarUnpack:
  - "**/*.node"
  - "node_modules/onnxruntime-node/**"
  - "node_modules/sharp/**"
```

The full `node_modules/onnxruntime-node/**` glob is needed because `onnxruntime-node` ships multiple shared libraries alongside the `.node` file.

### Server bundle (esbuild)

The server is **bundled** into a single ~17 MB CJS file rather than copied as a `node_modules` tree. This:

- Eliminates ~380 MB of `node_modules` from the build input
- Cuts the number of files macOS must individually codesign from thousands to one
- Simplifies `extraResources` to a single entry

`@xenova/transformers` (~15 MB JS) is **included** in the bundle. `onnxruntime-node` and `sharp` are marked external — they're resolved at runtime from `node_modules/` (via asarUnpack).

---

## Testing patterns

### ESM module mocking

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

The factory runs **once** per test file (it's hoisted before all tests). Per-test state goes through the mutable `mockState` object.

### Don't reset state-tied mocks in `beforeEach` if `afterEach` touches the real module

`tray/tests/unit/config-store.test.ts` learned this the hard way: `afterEach` deleted a temp dir via `realFs.existsSync()` — but `realFs` was the *mocked* module, and a previous test had wired `existsSync` to throw. Reset mock overrides at the **top** of `afterEach`, before any cleanup that uses the same module.

### Excluded vs unit-tested files

- **Excluded** (no coverage, no tests): `main.ts`, `prefs-window.ts`, `preload.ts`, `tray-menu.ts`. These are thin Electron wiring — `npm run dev` is the canonical verification.
- **Excluded but unit-tested**: `server-manager.ts`. Has 11 tests covering its public surface (state machine, pre-flight, on/off subscription) but the fork lifecycle itself is excluded from coverage gating because it requires a live `utilityProcess`.
- **Coverage-gated**: `config-store.ts`, `autostart.ts`. Pure logic, fully testable in vitest.

When you add a new file, decide which bucket it belongs in and update `tray/vitest.config.ts` accordingly.

---

## Common dev tasks

### Adding a new menu item

Edit `tray/src/tray-menu.ts` → `buildMenu()`. The menu is fully rebuilt on every state change (Electron has no partial-update API), so just push a new `MenuItemConstructorOptions` into the right section. State-conditional items go inside the `if (isRunning)` / `else` blocks.

If your item triggers a server change, call `void serverManager.restart()` from the click handler — it will gracefully drain the old server before the new one starts.

### Adding a new preference

1. Extend `VaultGateConfig` in `tray/src/config-store.ts`.
2. Add a default in the `DEFAULTS` object.
3. Add a form field in `tray/renderer/prefs.html`.
4. Wire it up in `tray/renderer/prefs.js`.
5. If the server needs to know about it, set the corresponding env var in `server-manager.ts` → `start()` → `utilityProcess.fork({ env })`.
6. Add a test for the new field's persistence in `tray/tests/unit/config-store.test.ts`.

### Bumping the embedding model

`MODEL_ID` lives in `src/tools/semantic.ts`. After changing it:

1. Update `INDEX_VERSION` in the same file (forces re-embedding).
2. Update `tray/scripts/download-models.js` to match.
3. Update the asar layout note in the developer guide if the directory structure changes.
4. Bump CI cache key in `.github/workflows/tray.yml` so old caches don't pollute new builds.

### Forwarding a new server log line

`server-manager.ts` already pipes `proc.stdout` and `proc.stderr` into `vaultgate.log` and emits a `log` event. New consumers subscribe via `serverManager.on("log", listener)`.

---

## Where things get debugged

| Symptom | First place to look |
|---------|---------------------|
| Tray icon never appears | macOS Console.app → filter "VaultGate" |
| Server says "stdio mode" in logs | The `OBSIDIAN_MCP_TRANSPORT=http` env var is missing on the fork — check `server-manager.ts` `start()` |
| Smart Search stays "warming up" forever | `Open Logs…` then look for `[server:err]` entries from `@xenova/transformers`; confirm `assets/models/` populated |
| Build fails with "node_modules/.cache" mismatch | Run `cd tray && npx @electron/rebuild` to recompile native addons against the current Electron ABI |
| `utilityProcess.fork()` exits immediately with code 1 | Bundle is broken — check `dist/server/server.js` exists and `OBSIDIAN_CLI_PATH` resolves |
| Coverage thresholds drop after a refactor | Inspect the file in the report. If it's genuinely Electron-bound, exclude it in `vitest.config.ts` with a comment explaining why |

---

## Plan document

For the full design rationale — every architectural decision, the alternatives evaluated, and the verification checklist — refer to the private implementation notes kept alongside the codebase (not published to the repository).
