import { defineConfig } from "vitest/config";

/**
 * Tray companion test config.
 *
 * Coverage thresholds match the root project (lines 90 / functions 90 /
 * branches 85). The tray is held to the same bar as everything else, with a
 * deliberately small set of exclusions justified file-by-file below.
 *
 * Where a file mixed pure logic with Electron wiring, the pure logic was
 * extracted into a separate module (`auto-detect.ts`, `tray-labels.ts`) and
 * tested fully. The exclusions below are only files where the remaining
 * content is genuinely Electron-bound and cannot be exercised meaningfully
 * in headless vitest.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Entry-point script: requestSingleInstanceLock, dock.hide, app.whenReady
        // listener that calls already-tested functions in order. Decision logic
        // (autoDetectFirstRun) was extracted to ./auto-detect.ts and is tested.
        // What remains is sequential orchestration; if it breaks the tray icon
        // never appears — caught by `npm run dev` on first launch.
        "src/main.ts",
        // contextBridge.exposeInMainWorld(...) wiring. Each bridge property is
        // `(args) => ipcRenderer.invoke('prefs:X', args)` — testing would only
        // verify the channel name on each invoke call, a tautology that locks
        // the test to its implementation.
        "src/preload.ts",
        // Registers ipcMain.handle for 7 channels, each wrapping a function that
        // is already covered by config-store.test.ts / autostart.test.ts.
        // openPrefsWindow() constructs a BrowserWindow — pure Electron. Marginal
        // value of testing thin wrappers does not justify the mock surface.
        "src/prefs-window.ts",
        // Pure label generators were extracted to ./tray-labels.ts (fully
        // tested). What remains is `new Tray(...)`, `Menu.buildFromTemplate`,
        // and click handlers that delegate to other tested modules. Mocking
        // Electron's Menu/Tray to assert on the items array would lock the
        // test to the exact menu structure, becoming a maintenance burden
        // every time the menu order changes.
        "src/tray-menu.ts",
        // utilityProcess.fork() lifecycle + MessageChannelMain port handoff +
        // crash-restart timer logic + stdio piping. Mocking Electron's IPC
        // accurately enough to exercise crash recovery and message-port
        // semantics would require an extensive mock surface that itself
        // becomes a maintenance burden — every Electron IPC contract change
        // would mean updating mocks. The 11 unit tests that DO exist cover
        // the public state machine surface (pre-flight failures, idempotent
        // start, on() subscription) — the parts most likely to change. The
        // fork-internals are stable Electron contract verified manually via
        // `npm run dev` (see plan §Verification).
        "src/server-manager.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
      // Always list every included file in the report — by default v8's
      // text reporter hides files at 100% coverage, which makes it look
      // like they aren't being measured at all.
      skipFull: false,
      reporter: ["text", "lcov"],
      // Note on the text reporter: vitest 4.x's v8 text reporter still hides
      // files at 100 % coverage even with `skipFull: false`. The numbers in
      // the "Coverage summary" line at the bottom (and the LCOV output) are
      // correct — autostart.ts and tray-labels.ts are both fully measured
      // at 100 %. Run `npm run test:coverage` and check the summary or the
      // generated `coverage/lcov.info` if you need per-file confirmation.
    },
  },
});
