/**
 * A terminal on a session the host runner started, attached through the runner.
 *
 * The dashboard attaches a terminal with `screen -A -x` where it runs. In its container that reaches a session on
 * the machine only when both share screen's socket directory and the machine's process namespace, and since #564 they
 * share neither: the container has a process space and a socket directory of its own. (Before, they often did not
 * either: the container moved its sockets to a directory of its own because /run/screen was not usable when it
 * started (screen-dir.mts), the runner used another directory, or the container could not share the machine's
 * processes (Docker Desktop).) The window said "There is no screen to be attached matching <session>" twice and closed.
 *
 * The runner attaches on the machine instead (`/attach/<session>`, scripts/screen-runner.js), and this relays the
 * frames both ways: over the runner's unix socket in .screens/ (the folder both sides share, no network in between),
 * or its port when there is no socket. Only for a session that screen here does not list and the runner does;
 * everything else is attached here, exactly as before.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { isKeepalive, type Frame } from './terminal-keepalive.mts';

/** A session in a listing: screen's own here, or the one the runner published. */
export interface SessionRow { session: string }

/** Where the host runner answers and the token it asks for. */
export interface Runner { base: string; token: string }

/** What the relay uses of a `ws` WebSocket, on either end (the package ships no types). */
export interface RelaySocket {
  readonly readyState: number;
  on(event: 'message', listener: (data: Frame, isBinary: boolean) => void): unknown;
  on(event: 'close', listener: (code: number) => void): unknown;
  on(event: 'open' | 'error', listener: () => void): unknown;
  send(data: Frame, opts: { binary: boolean }): void;
  close(): void;
  terminate(): void;
}
type RelaySocketClass = new (url: string, opts: { handshakeTimeout: number }) => RelaySocket;

/**
 * Should this session be attached through the runner? Yes when the runner is up and lists it, and screen where the
 * dashboard runs does not. `ownRows` is that screen's own listing, `published` the runner's (jobs.hostSessionsFile).
 */
export function attachesThroughRunner(session: string,
  { ownRows = [], published = null }: { ownRows?: readonly SessionRow[]; published?: { sessions?: unknown } | null } = {}): boolean {
  if (ownRows.some((s) => s.session === session)) return false;
  return !!(published && Array.isArray(published.sessions) && (published.sessions as SessionRow[]).some((s) => s.session === session));
}

/** Where the runner's attach is: its unix socket in the store when it left one, else its port. */
export function attachUrl(store: string, runner: Runner, session: string, { cols, rows }: { cols: number | string; rows: number | string }): string {
  const q = `/attach/${encodeURIComponent(session)}?token=${encodeURIComponent(runner.token)}&cols=${cols}&rows=${rows}`;
  const sock = path.join(store, 'runner.sock');
  let unix = false;
  try { unix = fs.statSync(sock).isSocket(); } catch (_) { unix = false; }
  return unix ? `ws+unix:${sock}:${q}` : `${runner.base.replace(/^http/, 'ws')}${q}`;
}

/**
 * Relay `ws` (the browser's) to the runner's attach of `session`. Resolves true once the runner took it, false when
 * it could not be reached, so the caller attaches here instead. The window's keepalive is answered here and never
 * sent on. A runner that ends the attach cleanly (the session ended) closes the window cleanly; one that drops it
 * drops the window too, which then attaches itself again (public/terminal.js).
 */
export function relay(ws: RelaySocket, url: string, { timeoutMs = 5000 }: { timeoutMs?: number } = {}): Promise<boolean> {
  const WebSocket = createRequire(import.meta.url)('ws') as RelaySocketClass;
  return new Promise((resolve) => {
    let up: RelaySocket;
    try { up = new WebSocket(url, { handshakeTimeout: timeoutMs }); } catch (_) { resolve(false); return; }
    let open = false;
    up.on('error', () => {
      if (!open) { resolve(false); return; }
      try { ws.terminate(); } catch (_) { /* gone */ }
    });
    up.on('open', () => {
      open = true;
      resolve(true);
      // The window closed while this was connecting: nothing to relay to.
      if (ws.readyState !== 1) { try { up.close(); } catch (_) { /* closed */ } return; }
      up.on('message', (d, isBinary) => { try { ws.send(d, { binary: isBinary }); } catch (_) { /* closing */ } });
      ws.on('message', (d, isBinary) => {
        if (isKeepalive(d, isBinary)) {
          try { ws.send(Buffer.alloc(0), { binary: true }); } catch (_) { /* closing */ }
          return;
        }
        try { up.send(d, { binary: isBinary }); } catch (_) { /* gone */ }
      });
      // A runner that went away (1001, it is stopping) or dropped (1006) drops the window, which attaches itself again
      // when the runner is back; a clean close is the session's attach ending, and closes the window cleanly.
      up.on('close', (code) => {
        try { if (code === 1006 || code === 1001) ws.terminate(); else ws.close(); } catch (_) { /* closed */ }
      });
      ws.on('close', () => { try { up.close(); } catch (_) { /* closed */ } });
      ws.on('error', () => { try { up.terminate(); } catch (_) { /* closed */ } });
    });
  });
}
