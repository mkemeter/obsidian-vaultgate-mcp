#!/usr/bin/env node
/**
 * Smoke test for the packed npm tarball.
 *
 * Run after `npm run build && npm pack`:
 *   node scripts/smoke.mjs <path/to/obsidian-vaultgate-mcp-X.Y.Z.tgz>
 *
 * Installs the tarball into a temp directory, spawns the binary over stdio,
 * exchanges the MCP initialize + tools/list handshake, and asserts that the
 * expected number of tools are registered. Exits 0 on success, 1 on failure.
 *
 * This validates that:
 *   - The packed `files` allowlist includes everything needed at runtime
 *   - The `bin` paths resolve correctly after install
 *   - The server can respond to a real tools/list request
 */

import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename } from 'node:path';

const BASE_TOOL_COUNT = 34; // must match server/src/server.ts

const tarball = process.argv[2];
if (!tarball) {
  console.error('Usage: node scripts/smoke.mjs <path/to/tarball.tgz>');
  process.exit(1);
}
const absPath = resolve(tarball);

const dir = mkdtempSync(`${tmpdir()}/vaultgate-smoke-`);

function cleanup() {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

try {
  console.log(`[smoke] Installing ${basename(absPath)} into ${dir}…`);
  execSync(`npm install --prefix ${dir} --ignore-scripts ${absPath}`, { stdio: 'pipe' });

  // Health check requires a binary file at OBSIDIAN_CLI_PATH.
  // We don't need it to be executable — just to exist as a regular file.
  const fakeBin = `${dir}/obsidian-fake`;
  execSync(`touch "${fakeBin}" && chmod +x "${fakeBin}"`);

  const bin = `${dir}/node_modules/.bin/obsidian-vaultgate-mcp`;
  console.log(`[smoke] Spawning ${bin}…`);

  const child = spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, OBSIDIAN_MCP_TRANSPORT: 'stdio', OBSIDIAN_CLI_PATH: fakeBin },
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  let stdout = '';
  let resolved = false;

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error(`Timeout after 10 s. stderr:\n${stderr}`));
    }, 10_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();

      // MCP stdio uses newline-delimited JSON. Collect complete lines.
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? ''; // keep the incomplete tail

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg;
        try { msg = JSON.parse(trimmed); } catch { continue; }

        if (msg.id === 1 && msg.result?.serverInfo) {
          // initialize response received — send tools/list
          const req = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          child.stdin.write(req + '\n');
        }

        if (msg.id === 2 && msg.result?.tools) {
          clearTimeout(timeout);
          resolved = true;
          resolve(msg.result.tools.length);
        }
      }
    });

    child.on('error', (e) => { clearTimeout(timeout); reject(e); });
    child.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(new Error(`Process exited with code ${code} before responding.\nstderr:\n${stderr}`));
      }
    });

    // Send MCP initialize
    const init = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '0' },
      },
    });
    child.stdin.write(init + '\n');
  });

  child.kill();

  console.log(`[smoke] tools/list returned ${result} tool(s) (expected ≥ ${BASE_TOOL_COUNT}).`);
  if (result < BASE_TOOL_COUNT) {
    throw new Error(`Tool count ${result} is below the expected baseline of ${BASE_TOOL_COUNT}.`);
  }

  console.log('[smoke] PASS');
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(`[smoke] FAIL: ${err.message}`);
  cleanup();
  process.exit(1);
}
