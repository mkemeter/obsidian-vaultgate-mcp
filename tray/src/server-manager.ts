/**
 * Lifecycle manager for the bundled obsidian-vaultgate-mcp server.
 *
 * Responsibilities:
 *   - Pre-flight: verify Obsidian binary exists and the CLI is registered
 *   - Detect an already-running server on the configured port (reuse it)
 *   - Fork the server via Electron's `utilityProcess.fork()` with the correct env
 *   - Poll `/health` to detect a successful start (replaces stdout parsing)
 *   - Restart on crash with exponential backoff; give up after 3 rapid crashes
 *   - Forward semantic-indexing progress events to the rest of the app
 *   - Forward stdout/stderr to a rotating log file
 *   - Graceful shutdown: SIGTERM, then SIGKILL after 3s
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import {
  app,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { loadConfig } from "./config-store.js";

/** High-level state of the server lifecycle (drives tray menu rendering). */
export type ServerState =
  | "idle"
  | "starting"
  | "running"
  | "error"
  | "stopped"
  | "port-conflict"
  | "obsidian-missing";

/** Indexing progress event mirrored from the server's `emitProgress()`. */
export interface IndexProgressEvent {
  type: "state" | "progress" | "complete" | "error";
  state?: "idle" | "building" | "ready" | "error";
  progress?: number;
  filesProcessed?: number;
  totalFiles?: number;
  error?: string;
}

/** Public events emitted by the manager. */
export interface ServerManagerEvents {
  state: (state: ServerState) => void;
  indexProgress: (event: IndexProgressEvent) => void;
  log: (line: string) => void;
}

const HEALTH_TIMEOUT_MS = 5000;
const SHUTDOWN_TIMEOUT_MS = 3000;
const MAX_RAPID_CRASHES = 3;
const RAPID_CRASH_WINDOW_MS = 10_000;
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const LOG_RETAIN_FILES = 3;

let child: UtilityProcess | undefined;
let state: ServerState = "idle";
let latestIndex: IndexProgressEvent = { type: "state", state: "idle" };
let rapidCrashCount = 0;
let lastStartedAt = 0;
let restartTimer: NodeJS.Timeout | undefined;
let logStream: fs.WriteStream | undefined;
const emitter = new EventEmitter();

/** Resolves the path to the bundled server entry — different in dev vs packaged. */
function resolveServerScript(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "server", "build", "index.js");
  }
  return path.join(__dirname, "..", "..", "server", "build", "index.js");
}

/** Returns the absolute path to the rotating log file. */
function logFilePath(): string {
  return path.join(app.getPath("userData"), "vaultgate.log");
}

/** Lazy-opens the log file write stream, rotating if it has grown past the cap. */
function getLogStream(): fs.WriteStream {
  if (logStream) return logStream;
  const file = logFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const stat = fs.statSync(file);
    if (stat.size > LOG_MAX_BYTES) rotateLogs(file);
  } catch {
    /* file does not exist yet */
  }
  logStream = fs.createWriteStream(file, { flags: "a" });
  // Async write/open errors (disk full, dir removed, permissions) must not
  // become uncaught exceptions. Logging is best-effort.
  logStream.on("error", () => {
    /* swallow */
  });
  return logStream;
}

/** Performs `name → name.1 → name.2` rotation, dropping anything beyond LOG_RETAIN_FILES. */
function rotateLogs(file: string): void {
  for (let i = LOG_RETAIN_FILES - 1; i >= 1; i -= 1) {
    const src = i === 1 ? file : `${file}.${i - 1}`;
    const dst = `${file}.${i}`;
    if (fs.existsSync(src)) {
      try {
        if (fs.existsSync(dst)) fs.unlinkSync(dst);
        fs.renameSync(src, dst);
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Writes a line to the log file and emits a `log` event for live consumers. */
function log(line: string): void {
  const formatted = `[${new Date().toISOString()}] ${line}\n`;
  try {
    getLogStream().write(formatted);
  } catch {
    /* swallow disk errors */
  }
  emitter.emit("log", line);
}

/** Updates state and emits the change to listeners. */
function setState(next: ServerState): void {
  if (next === state) return;
  state = next;
  log(`state → ${next}`);
  emitter.emit("state", next);
}

/**
 * GET http://127.0.0.1:port/health with a short timeout.
 * Returns "vaultgate" if the response is a VaultGate server (body === "OK"),
 * "other" if something else is listening on that port, or "none" if nothing responds.
 */
function checkHealth(port: number): Promise<"vaultgate" | "other" | "none"> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 500 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200 && body.trim() === "OK") {
            resolve("vaultgate");
          } else if (res.statusCode !== undefined) {
            resolve("other");
          } else {
            resolve("none");
          }
        });
      }
    );
    req.on("error", () => resolve("none"));
    req.on("timeout", () => {
      req.destroy();
      resolve("none");
    });
  });
}

/** Polls `/health` with exponential backoff until success or timeout. */
async function waitForHealthy(port: number): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let delay = 100;
  while (Date.now() < deadline) {
    if (await checkHealth(port) === "vaultgate") return true;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 800);
  }
  return false;
}

/**
 * Starts the server. Idempotent — if already running, this is a no-op.
 *
 * Sequence:
 *   1. Verify Obsidian binary exists
 *   2. Probe `/health` — if a server is already up on this port, reuse it
 *   3. Fork via `utilityProcess.fork()` with `OBSIDIAN_MCP_TRANSPORT=http`
 *   4. Wire up MessageChannel for indexing progress
 *   5. Poll `/health` until the listener is up
 */
export async function start(): Promise<void> {
  if (state === "running" || state === "starting") return;

  setState("starting");
  const config = loadConfig();

  // ---- pre-flight: Obsidian binary exists? ---------------------------------
  if (!config.obsidianPath || !fs.existsSync(config.obsidianPath)) {
    setState("obsidian-missing");
    return;
  }

  // ---- pre-flight: check what's on this port --------------------------------
  const portProbe = await checkHealth(config.port);
  if (portProbe === "vaultgate") {
    log(`reusing existing VaultGate server on port ${config.port}`);
    setState("running");
    return;
  }
  if (portProbe === "other") {
    log(`port ${config.port} is already in use by another service`);
    setState("port-conflict");
    return;
  }

  // ---- fork --------------------------------------------------------------
  const serverScript = resolveServerScript();
  if (!fs.existsSync(serverScript)) {
    log(`server bundle not found at ${serverScript}`);
    setState("error");
    return;
  }

  const modelDir = app.isPackaged
    ? path.join(process.resourcesPath, "models")
    : path.join(__dirname, "..", "assets", "models");

  // ⚠️ utilityProcess.fork() — NOT child_process.fork().
  // ⚠️ OBSIDIAN_MCP_TRANSPORT=http is REQUIRED — without it the server falls
  //    through to stdio mode (isTTY is undefined inside utilityProcess) and
  //    never opens an HTTP listener.
  const proc = utilityProcess.fork(serverScript, [], {
    env: {
      ...process.env,
      OBSIDIAN_MCP_TRANSPORT: "http",
      OBSIDIAN_MCP_PORT: String(config.port),
      OBSIDIAN_VAULT: config.vault,
      OBSIDIAN_CLI_PATH: config.obsidianPath,
      // Semantic search: point at pre-bundled cache, disable remote download.
      VAULTGATE_MODEL_CACHE_DIR: modelDir,
      VAULTGATE_ALLOW_REMOTE_MODELS: "false",
    },
    stdio: "pipe",
  });
  child = proc;
  lastStartedAt = Date.now();

  // Forward stdout/stderr to the log file
  proc.stdout?.on("data", (chunk: Buffer) => log(`[server] ${chunk.toString().trimEnd()}`));
  proc.stderr?.on("data", (chunk: Buffer) => log(`[server:err] ${chunk.toString().trimEnd()}`));

  // ---- wire indexing progress channel -------------------------------------
  // The server sends progress events via process.parentPort.postMessage(),
  // which the parent receives via proc.on("message", ...).
  proc.on("message", (msg: unknown) => {
    if (msg && typeof msg === "object" && "__vaultgate_index__" in msg) {
      const ev = (msg as { __vaultgate_index__: IndexProgressEvent }).__vaultgate_index__;
      // Merge onto latestIndex so that `state` (set once by a "state" event) is
      // not clobbered by per-note "progress" events which carry no `state` field.
      latestIndex = { ...latestIndex, ...ev };
      emitter.emit("indexProgress", ev);
    }
  });

  // ---- crash handler -------------------------------------------------------
  proc.on("exit", (code: number) => {
    log(`server exited with code ${code}`);
    child = undefined;
    if (state === "stopped") return; // intentional shutdown — do not restart

    const ranFor = Date.now() - lastStartedAt;
    if (ranFor < RAPID_CRASH_WINDOW_MS) {
      rapidCrashCount += 1;
    } else {
      rapidCrashCount = 0;
    }

    if (rapidCrashCount >= MAX_RAPID_CRASHES) {
      log(`giving up after ${rapidCrashCount} rapid crashes`);
      setState("error");
      return;
    }

    const backoff = Math.min(2 ** rapidCrashCount, 30) * 1000;
    log(`scheduling restart in ${backoff}ms`);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      void start();
    }, backoff);
  });

  // ---- wait for HTTP listener to come up -----------------------------------
  const ready = await waitForHealthy(config.port);
  if (!ready) {
    log("server failed to become healthy within timeout");
    setState("error");
    try {
      proc.kill();
    } catch {
      /* swallow */
    }
    return;
  }
  setState("running");
}

/**
 * Stops the server. Sends SIGTERM (handled by the server's Phase 0 shutdown
 * handler). If the process is still alive after SHUTDOWN_TIMEOUT_MS, escalates
 * to a hard kill.
 */
export async function stop(): Promise<void> {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }
  if (!child) {
    setState("stopped");
    return;
  }
  setState("stopped");
  // Reset the cached index state so the tray menu does not show stale "ready"
  // data after the server process is replaced with a new one.
  latestIndex = { type: "state", state: "idle" };
  const proc = child;
  try {
    proc.kill();
  } catch {
    /* already gone */
  }
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);
  if (child) {
    try {
      // utilityProcess.kill() does not accept a signal; if it survived once,
      // call kill() again to escalate (Electron will SIGKILL on second call).
      child.kill();
    } catch {
      /* swallow */
    }
    child = undefined;
  }
}

/** Convenience wrapper: stop, then start. */
export async function restart(): Promise<void> {
  await stop();
  await start();
}

/** Returns the current server state. */
export function getState(): ServerState {
  return state;
}

/** Returns the most recent indexing progress event seen from the server. */
export function getIndexState(): IndexProgressEvent {
  return latestIndex;
}

/** Subscribe to manager events. Returns an unsubscribe function. */
export function on<K extends keyof ServerManagerEvents>(
  event: K,
  listener: ServerManagerEvents[K]
): () => void {
  emitter.on(event, listener as (...args: unknown[]) => void);
  return () => emitter.off(event, listener as (...args: unknown[]) => void);
}

/** Returns the absolute log file path (used by "Open Logs…" menu item). */
export function getLogPath(): string {
  return logFilePath();
}

/**
 * Sends a vault-change message to the running server process so it can update
 * config.vault in place without a full restart. No-op if the server is not
 * currently running.
 */
export function sendVaultChange(vault: string): void {
  if (!child) return;
  child.postMessage({ __vaultgate_config__: { vault } });
}

/**
 * Probes a port and returns whether it is available for VaultGate to bind.
 * Used by the Preferences window for inline port validation.
 *   - "free"      → nothing is listening on this port
 *   - "vaultgate" → VaultGate is already running here (safe to reuse)
 *   - "conflict"  → another service is using this port
 */
export async function checkPortAvailability(
  port: number
): Promise<"free" | "vaultgate" | "conflict"> {
  const result = await checkHealth(port);
  if (result === "none") return "free";
  if (result === "vaultgate") return "vaultgate";
  return "conflict";
}
