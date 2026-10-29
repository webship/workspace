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

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

function logFile() {
  return process.env.WORKSPACE_APP_LOG || path.join(__dirname, 'logs', 'dashboard.log');
}

/** Known secret shapes and `key: value` pairs that name one, replaced before anything is written. */
function redact(text) {
  return String(text == null ? '' : text)
    .replace(/\b(sk|pk|ghp|gho|ghs|github_pat|xox[abprs]|glpat|AIza)[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b([A-Za-z_]*(?:password|passwd|token|secret|api[_-]?key)[A-Za-z_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[redacted]');
}

function clip(text, max = 300) {
  const s = redact(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The text of an HTML message, for a log line: tags gone, entities left as they are. */
function plain(html, max = 240) {
  return clip(String(html || '').replace(/<[^>]*>/g, ' '), max);
}

function rotate(file) {
  for (let i = KEEP - 1; i >= 1; i--) {
    try { fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`); } catch (_) { /* not there yet */ }
  }
  try { fs.renameSync(file, `${file}.1`); } catch (_) { /* nothing to rotate */ }
}

function logEvent(level, event, fields = {}) {
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

module.exports = { logEvent, redact, clip, plain, logFile, MAX_BYTES, KEEP };
