/**
 * Integration test — a malformed `Host` header must not crash the server
 * entry point (regression: P0 bug).
 *
 * src/index.ts builds the request URL as
 *   new URL(req.url ?? "/", `http://${req.headers.host}`)
 * with no validation. A client that sends `Host: bad host` (spaces are legal
 * in a raw header field) makes `new URL()` throw a TypeError inside the async
 * request handler → unhandledRejection → the whole process exits. Any MCP
 * client or scanner that sends a malformed Host takes down the server.
 *
 * Unlike http.test.ts — which inlines a copy of the routing handler and can
 * never catch this — this test spawns the REAL `build/index.js` with a fake
 * Obsidian CLI and asserts the process survives the malformed request.
 *
 * Requires a prior `npm run build` (CI runs the build before the server test
 * job; locally: `npm run build && npm test`).
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BUILD_INDEX = fileURLToPath(new URL("../../build/index.js", import.meta.url));

let baseDir: string;
let port = 0;
let child: childProcess.ChildProcess;
let childStderr = "";

/** Find a free loopback port by briefly binding port 0. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

/** GET /health — resolves to the status or the transport error (never throws). */
function healthGet(extraHeaders: Record<string, string> = {}): Promise<{
  status?: number;
  body?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 3000, headers: extraHeaders },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", (err) => resolve({ error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: "timeout" });
    });
  });
}

async function waitForServerHealthy(deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let last: string = "not probed yet";
  while (Date.now() < deadline) {
    const res = await healthGet();
    if (res.status === 200) return;
    last = JSON.stringify(res);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `server did not become healthy within ${deadlineMs} ms (last probe: ${last})\n` +
      `--- child stderr ---\n${childStderr.slice(-4000)}`
  );
}

beforeAll(async () => {
  expect(
    fs.existsSync(BUILD_INDEX),
    "build/index.js missing — run `npm run build` in server/ first"
  ).toBe(true);

  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-badhost-"));

  // Fake Obsidian CLI: a real executable file (the startup health check only
  // inspects it, never runs it; the background index build runs it and gets an
  // empty file list, which is harmless for this test).
  const fakeBin = path.join(baseDir, "obsidian");
  fs.writeFileSync(fakeBin, "#!/bin/sh\nexit 0\n", "utf-8");
  if (process.platform !== "win32") fs.chmodSync(fakeBin, 0o755);

  port = await getFreePort();
  child = childProcess.spawn(process.execPath, [BUILD_INDEX], {
    cwd: baseDir,
    env: {
      ...process.env,
      OBSIDIAN_MCP_TRANSPORT: "http",
      OBSIDIAN_MCP_PORT: String(port),
      OBSIDIAN_CLI_PATH: fakeBin,
      VAULTGATE_INDEX_CACHE_DIR: path.join(baseDir, "index-cache"),
      VAULTGATE_INJECT_CONVENTIONS: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", () => {}); // drain
  child.stderr?.on("data", (d: Buffer) => {
    childStderr += d.toString();
  });

  await waitForServerHealthy();
}, 60_000);

afterAll(() => {
  if (child && !child.killed) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  if (baseDir) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("malformed Host header must not take down the server (regression)", () => {
  it("survives a request whose Host header is not a valid URL authority", async () => {
    // "bad host" is a legal raw HTTP header field value (SP-separated tokens
    // without port/host syntax) but makes `new URL(req.url, "http://bad host")`
    // throw. The response itself is implementation-dependent (200, 400, or a
    // dropped connection) — the contract is that the process keeps serving.
    await healthGet({ Host: "bad host" });

    // Give an unhandledRejection (the historical failure mode) time to kill
    // the process before we probe again.
    await new Promise((r) => setTimeout(r, 1500));

    expect(
      child.exitCode,
      `server process died after the malformed Host request (exit code ${child.exitCode}).\n` +
        `--- child stderr ---\n${childStderr.slice(-4000)}`
    ).toBeNull();

    // And it must still be serving: a clean /health probe succeeds.
    const res = await healthGet();
    expect(
      res,
      `server not serving after the malformed Host request.\n--- child stderr ---\n${childStderr.slice(-4000)}`
    ).toEqual({ status: 200, body: "OK" });
  }, 60_000);
});
