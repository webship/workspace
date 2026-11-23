/**
 * A log for tracking what went wrong, and when.
 *
 * actions.log says what was done; nothing said what was refused or what broke, and the request that failed
 * left no trace at all: a rejected form answers 400 to one browser and is gone. This is that trace, one JSON
 * object per line in logs/dashboard.log, kept on this machine (gitignored, never synced).
 *
 * Text that reaches it goes through redact() and clip() first: a prompt can hold a token, and a log is
 * the one file nobody reviews.
 */

import fs from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 5 * 1024 * 1024;
export const KEEP = 3;

/**
 * Where the log goes: WORKSPACE_APP_LOG, else logs/dashboard.log beside the dashboard. Read on every call, so the
 * module keeps no state: a test points it at a file of its own by setting the variable, with no reload (an ES module
 * is not reloaded through require.cache).
 */
export function logFile(): string {
  return process.env.WORKSPACE_APP_LOG || path.join(import.meta.dirname, 'logs', 'dashboard.log');
}

/** Known secret shapes and `key: value` pairs that name one, replaced before anything is written. */
export function redact(text: unknown): string {
  return String(text == null ? '' : text)
    .replace(/\b(sk|pk|ghp|gho|ghs|github_pat|xox[abprs]|glpat|AIza)[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b([A-Za-z_]*(?:password|passwd|token|secret|api[_-]?key)[A-Za-z_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]');
}

export function clip(text: unknown, max = 300): string {
  const s = redact(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The text of an HTML message, for a log line: tags gone, entities left as they are. */
export function plain(html: unknown, max = 240): string {
  return clip(String(html || '').replace(/<[^>]*>/g, ' '), max);
}

function rotate(file: string): void {
  for (let i = KEEP - 1; i >= 1; i--) {
    try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch (_) { /* not there yet */ }
  }
  try { fs.renameSync(file, `${file}.1`); } catch (_) { /* nothing to rotate */ }
}

export function logEvent(level: string, event: string, fields: Record<string, unknown> = {}): void {
  const file = logFile();
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch (_) { /* first write */ }
    if (size > MAX_BYTES) rotate(file);
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch (_) { /* a log must never take an action down with it */ }
}

