/**
 * The assistant's conversation, kept so it survives the next page.
 *
 * Every ask used to be a one-shot `claude -p --no-session-persistence`: the assistant remembered
 * nothing between turns, and deep-chat's transcript lived only in the page that drew it — so moving
 * from /dev to /test, or following the assistant's own NAVIGATE, threw the conversation away. On a
 * dashboard whose whole point is moving between workspaces, that is most of the conversation.
 *
 * Two halves, and both are needed:
 *
 *   - the TRANSCRIPT, so the next page can draw what was said (deep-chat's `history`);
 *   - the claude SESSION id, so the assistant itself still remembers — a redrawn transcript in
 *     front of an agent with no memory is worse than none, because it reads as memory.
 *
 * The id travels in a COOKIE, not localStorage, and that is the crux: the dashboard spans
 * <workspace>.<hub> subdomains and localStorage is per-origin, so a thread kept there would be a
 * different thread on every workspace page — exactly the bug this fixes. The lists' page-size cookie
 * already had to be scoped to the hub domain for the same reason.
 *
 * The file is this machine's chat log. It is gitignored, never synced, and holds whatever was typed,
 * so it is treated like the rest of the runtime state: capped, pruned, and never committed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { hubDomain } = require('./workspaces');

const DIR = path.join(__dirname, '.chats');

// What one thread keeps. A long conversation is trimmed from the front rather than refused: the
// newest turns are the ones the next page has to draw, and claude's own session holds the rest.
const MAX_TURNS = 60;
// One turn's rendered HTML can be a whole report; past this it is stored as its text alone.
const MAX_TURN_CHARS = 20000;
// A thread nobody has touched in a month is not a conversation any more.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isId = (id) => /^[a-f0-9]{32}$/.test(String(id || ''));
const newId = () => crypto.randomBytes(16).toString('hex');
const fileFor = (id) => path.join(DIR, `${id}.json`);

/** The thread id this request carries, or null. Only our own shape is accepted — the id names a file. */
function threadIdFrom(req) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  const hit = raw.split(';').map((c) => c.trim().split('=')).find((p) => p[0] === 'ws-chat');
  return hit && isId(hit[1]) ? hit[1] : null;
}

/**
 * The Set-Cookie that keeps one thread across the workspace subdomains. No Max-Age: the conversation
 * belongs to this browsing session, and a chat log that outlives the browser being closed is a
 * surprise, not a feature. The store prunes the file either way.
 */
function threadCookie(id) {
  return `ws-chat=${id}; Path=/; Domain=.${hubDomain()}; SameSite=Lax`;
}

function readThread(id) {
  if (!isId(id)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
    return t && Array.isArray(t.turns) ? t : null;
  } catch (_) {
    return null;
  }
}

/** The thread this request is in, created only when something is written to it. */
function loadThread(req) {
  const id = threadIdFrom(req);
  return (id && readThread(id)) || { id: id || newId(), sessionId: null, turns: [], updated: 0 };
}

function writeThread(t) {
  const thread = { ...t, updated: Date.now(), turns: t.turns.slice(-MAX_TURNS) };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    // 0600: it is a chat log. The dashboard runs as one user, but the file says so on disk too.
    fs.writeFileSync(fileFor(thread.id), JSON.stringify(thread), { mode: 0o600 });
  } catch (_) { /* a thread that cannot be written is a conversation without memory, not an error */ }
  return thread;
}

/** One turn. `html` is what deep-chat draws for the assistant; the user's turn is plain text. */
function appendTurn(thread, turn) {
  const t = { ...turn, at: Date.now() };
  if (t.html && t.html.length > MAX_TURN_CHARS) t.html = null;
  if (t.text && t.text.length > MAX_TURN_CHARS) t.text = `${t.text.slice(0, MAX_TURN_CHARS)}…`;
  return writeThread({ ...thread, turns: [...thread.turns, t] });
}

/**
 * The transcript as deep-chat's `history`. Its own shape: `role` is 'user' or 'ai', and a message
 * carries either `text` or `html` — the assistant's replies are already rendered markdown, so they
 * are handed back as html rather than re-escaped into text.
 */
function historyFor(thread) {
  return (thread.turns || [])
    .map((t) => (t.role === 'ai'
      ? (t.html ? { role: 'ai', html: t.html } : { role: 'ai', text: t.text || '' })
      : { role: 'user', text: t.text || '' }))
    .filter((m) => m.html || m.text);
}

/** Forget this conversation: the file, and with it the claude session it resumed. */
function clearThread(id) {
  if (!isId(id)) return;
  try { fs.unlinkSync(fileFor(id)); } catch (_) { /* already gone */ }
}

/**
 * Drop threads nobody has touched in a month. Called when one is written rather than on a timer:
 * there is no scheduler in this app, and the moment a thread is used is a fine moment to sweep.
 */
function pruneThreads(now = Date.now()) {
  let removed = 0;
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { return 0; }
  for (const f of files) {
    if (!/^[a-f0-9]{32}\.json$/.test(f)) continue;
    try {
      if (now - fs.statSync(path.join(DIR, f)).mtimeMs > MAX_AGE_MS) { fs.unlinkSync(path.join(DIR, f)); removed += 1; }
    } catch (_) { /* raced with another write */ }
  }
  return removed;
}

module.exports = {
  DIR, MAX_TURNS, MAX_AGE_MS,
  isId, newId, threadIdFrom, threadCookie,
  loadThread, readThread, writeThread, appendTurn, historyFor, clearThread, pruneThreads,
};
