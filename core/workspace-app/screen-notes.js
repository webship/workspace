/**
 * What a screen session was, kept after it is gone.
 *
 * `screen -ls` knows only what runs now. A session that ends (the machine restarts, a window is closed,
 * a command finishes, Claude Code is told /exit) left the Screens list without a trace, and with it the
 * only things that lead back to its Claude Code conversation: the folder it ran in and the session id.
 * The transcript itself is still in ~/.claude/projects, among every other conversation that folder ever
 * had, and nothing said which one it was.
 *
 * So every session the dashboard starts leaves a note: one small JSON file in <workspace>/.screens/notes/,
 * written when the session starts and stamped when it is found gone. The Past sessions list and its Read,
 * Resume and Forget work from these notes and from nothing else.
 *
 * Plain node and nothing more, so whatever starts a session can write one: the actions, jobs.js, and
 * scripts/screen-then.js on the host.
 */

const fs = require('fs');
const path = require('path');

/** How many notes are kept, newest first. A note is a few hundred bytes. */
const KEEP = 200;
/** A session that was seen running this recently and is gone now was seen ending. */
const SEEN_FRESH_MS = 2 * 60 * 1000;

const SESSION_RE = /^[a-z0-9][a-zA-Z0-9._-]{0,59}$/;
/** A note's id: when it started (milliseconds) and the session's name. Checked before it becomes a path. */
const NOTE_ID_RE = /^[0-9]{13}-[a-z0-9][a-zA-Z0-9._-]{0,59}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['shell', 'claude', 'command']);

const notesDir = (store) => path.join(store, 'notes');
const isNoteId = (id) => NOTE_ID_RE.test(String(id || ''));
const fileOf = (store, id) => path.join(notesDir(store), `${id}.json`);

/** Written beside and renamed over, so a list read at that moment never finds half a note. This user's only. */
function save(store, note) {
  const dir = notesDir(store);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${note.id}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(note), { mode: 0o600 });
  fs.renameSync(tmp, fileOf(store, note.id));
}

function readNote(store, id) {
  if (!isNoteId(id)) return null;
  try {
    const note = JSON.parse(fs.readFileSync(fileOf(store, id), 'utf8'));
    return note && note.id === id && SESSION_RE.test(String(note.session || '')) ? note : null;
  } catch (_) { return null; }
}

/** Every note, newest first. */
function allNotes(store) {
  let names = [];
  try { names = fs.readdirSync(notesDir(store)); } catch (_) { return []; }
  const notes = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const note = readNote(store, name.slice(0, -5));
    if (note) notes.push(note);
  }
  return notes.sort((a, b) => (b.started - a.started) || (a.id < b.id ? 1 : -1));
}

/**
 * The conversation a command line opens, when it runs Claude Code with an id: `--session-id <id>` for a
 * new one, `--resume <id>` for one picked up again. Empty for anything else.
 */
function claudeIdIn(line) {
  const s = String(line || '');
  if (!/(?:^|[\s;&|(])claude(?:\s|$)/.test(s)) return '';
  const m = s.match(/--(?:session-id|resume)[\s=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i);
  return m ? m[1].toLowerCase() : '';
}

/** Drop the oldest notes beyond `keep`. */
function prune(store, keep = KEEP) {
  for (const note of allNotes(store).slice(keep)) {
    try { fs.unlinkSync(fileOf(store, note.id)); } catch (_) { /* gone already */ }
  }
}

/**
 * Note a session that has just started, and return the note (null when it could not be written: a run
 * with no note still runs).
 *
 * `what` is what ran, as a person reads it; `claude` the conversation id when it ran Claude Code, and
 * `flags` the options it ran with, already checked against `claude --help` by whoever started it.
 */
function noteStarted(store, fields, now = Date.now()) {
  const f = fields || {};
  const session = String(f.session || '');
  if (!SESSION_RE.test(session)) return null;
  let at = Math.floor(now);
  try {
    // Two starts of one name in the same millisecond still get two notes.
    while (fs.existsSync(fileOf(store, `${at}-${session}`))) at += 1;
  } catch (_) { /* written below, or not at all */ }
  const note = {
    v: 1,
    id: `${at}-${session}`,
    session,
    dir: String(f.dir || ''),
    workspace: String(f.workspace || ''),
    project: String(f.project || ''),
    kind: KINDS.has(f.kind) ? f.kind : 'command',
    what: String(f.what || '').slice(0, 500),
    claude: UUID_RE.test(String(f.claude || '')) ? String(f.claude).toLowerCase() : '',
    flags: (Array.isArray(f.flags) ? f.flags : []).map(String).slice(0, 40),
    resumedFrom: isNoteId(f.resumedFrom) ? f.resumedFrom : '',
    started: at,
    ended: 0,
    end: '',
    lastSign: 0,
  };
  try {
    // An earlier run under the same name is over: screen does not start a second session of one name.
    for (const old of allNotes(store)) {
      if (old.session !== session || old.ended) continue;
      old.ended = at;
      old.end = 'gone';
      save(store, old);
    }
    save(store, note);
    prune(store);
  } catch (_) { return null; }
  return note;
}

/**
 * Bring the notes in line with what runs now.
 *
 * `live` is every session name running at this moment. `seen` maps a name to when this process last saw
 * it running, which is how a session it watched end (`end: 'seen'`, ended about now) is told from one that
 * ended while nobody was looking (`end: 'gone'`): the dashboard was down, or the machine restarted. For
 * those, `lastSignOf(note, newest)` says when the session last showed life (its log, its transcript), and
 * that is kept as `lastSign`. Only the newest note of a name can be the session running under it.
 *
 * A note stamped over and then found running again (the runner was down for a while and came back) is
 * opened again: it was never over. Returns how many notes changed.
 */
function settle(store, live, { seen = new Map(), now = Date.now(), lastSignOf = () => 0 } = {}) {
  const running = new Set(live || []);
  const named = new Set();
  let changed = 0;
  for (const note of allNotes(store)) {
    const newest = !named.has(note.session);
    named.add(note.session);
    try {
      if (newest && running.has(note.session)) {
        if (note.ended) {
          note.ended = 0;
          note.end = '';
          note.lastSign = 0;
          save(store, note);
          changed += 1;
        }
        continue;
      }
      if (note.ended) continue;
      const last = newest ? Number(seen.get(note.session)) || 0 : 0;
      note.ended = now;
      if (last && now - last <= SEEN_FRESH_MS) {
        note.end = 'seen';
      } else {
        note.end = 'gone';
        let sign = 0;
        try { sign = Number(lastSignOf(note, newest)) || 0; } catch (_) { sign = 0; }
        note.lastSign = Math.min(now, Math.max(note.started, last, sign));
      }
      save(store, note);
      changed += 1;
    } catch (_) { /* the next look tries again */ }
  }
  return changed;
}

/** The notes of sessions that are not running, newest first: what the Past sessions list shows. */
function pastNotes(store, live, { limit = 0 } = {}) {
  const running = new Set(live || []);
  const named = new Set();
  const out = [];
  for (const note of allNotes(store)) {
    const newest = !named.has(note.session);
    named.add(note.session);
    if (newest && running.has(note.session)) continue;
    out.push({ ...note, newest });
  }
  return limit ? out.slice(0, limit) : out;
}

/** The note of the session running under a name now, if the dashboard started it. */
function runningNoteOf(store, session, live) {
  if (!new Set(live || []).has(session)) return null;
  return allNotes(store).find((n) => n.session === session) || null;
}

/** Forget one note. The transcript and the log stay where they are. */
function forgetNote(store, id) {
  if (!isNoteId(id)) return false;
  try { fs.unlinkSync(fileOf(store, id)); return true; } catch (_) { return false; }
}

module.exports = {
  KEEP, SEEN_FRESH_MS, NOTE_ID_RE,
  notesDir, isNoteId, readNote, allNotes, claudeIdIn, noteStarted, settle, pastNotes, runningNoteOf, forgetNote, prune,
};
