/**
 * Port availability helpers used by the Preferences window.
 *
 * These are in their own module so they can be unit-tested without Electron.
 */

import * as net from "node:net";

const DEFAULT_PORT = 3002;
const PORT_SEARCH_LIMIT = 20;

/**
 * Returns `true` if nothing is listening on `127.0.0.1:port`, `false` otherwise.
 * Uses a TCP connect probe — fast and doesn't require HTTP.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(300);
    sock.once("connect", () => {
      sock.destroy();
      resolve(false); // something is listening
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(true); // connection refused → port is free
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(true); // no response → treat as free
    });
    sock.connect(port, "127.0.0.1");
  });
}

/**
 * Starting from `preferred`, finds the first free port within PORT_SEARCH_LIMIT
 * candidates. Falls back to `preferred` if no free port is found.
 */
export async function findFreePort(preferred: number): Promise<number> {
  // Try the preferred port first (it may already be free).
  // Then try ports above it (not below, to avoid well-known ranges).
  const candidates = [
    preferred,
    ...Array.from({ length: PORT_SEARCH_LIMIT }, (_, i) => DEFAULT_PORT + i),
  ];
  const seen = new Set<number>();
  for (const port of candidates) {
    if (seen.has(port)) continue;
    seen.add(port);
    if (port < 1024 || port > 65535) continue;
    if (await isPortFree(port)) return port;
  }
  return preferred;
}
