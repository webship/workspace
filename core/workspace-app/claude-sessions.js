/**
 * The Claude Code sessions a directory already has, so one can be RESUMED rather than started over.
 *
 * A screen session that dies — the machine reboots, the terminal closes, `screen -wipe` takes a dead
 * one — does not take the conversation with it: the Claude Code CLI keeps every session's transcript
 * under `~/.claude/projects/<the directory, slashes turned into dashes>/<session id>.jsonl`. Resuming
 * by id is `claude --resume <id>` from that same directory.
 *
 * By ID, deliberately, and not `--continue`: continue takes the most recent session for the directory,
 * which after a day of parallel work is often not the one meant. The id is exact.
 *
 * What is on disk is two different things, and only one of them can be resumed:
 *   <id>.jsonl   the transcript. This is what --resume reads, so this is what makes a session resumable.
 *   <id>/        that session's tool results and subagents. It exists on its own for a session whose
 *                transcript has not been written — and `claude --resume` on such an id answers
 *                "No conversation found with session ID", which is exactly what happened when this
 *                listed them: the screen started and died in the same second.
 * So `resumable` is the transcript, and a directory-only id is reported rather than offered.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this a session id we would hand to `claude --resume`? */
const isSessionId = (v) => UUID_RE.test(String(v || ''));

/**
 * The CLI's own name for a directory: the absolute path with every slash turned into a dash. So
 * /home/rajab/workspace/dev/ha1x00b1 is -home-rajab-workspace-dev-ha1x00b1.
 */
function projectSlug(dir) {
  return String(path.resolve(dir)).replace(/\//g, '-');
}

function projectDirFor(dir) {
  return path.join(PROJECTS, projectSlug(dir));
}

/**
 * The first thing the person typed, as the session's title. Read from the head of the file rather than
 * all of it: a long transcript is tens of megabytes and this runs while a form is being drawn.
 */
function titleOf(file) {
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.slice(0, n).toString('utf8');
  } catch (_) {
    return '';
  }
  for (const line of head.split('\n')) {
    if (!line.startsWith('{') || !line.includes('"type":"user"')) continue;
    try {
      const d = JSON.parse(line);
      const content = (d.message || {}).content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((p) => p && p.type === 'text').map((p) => p.text).join(' ')
          : '';
      const clean = String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean) return clean.slice(0, 90);
    } catch (_) { /* a half-written line at the head is not a title */ }
  }
  return '';
}

/**
 * Every resumable session for one directory, newest first.
 *
 * `at` is when it was last written — which is what "the one I was just in" means — and `title` is the
 * first thing typed in it, so two sessions in one project can be told apart without opening either.
 */
function sessionsFor(dir, { limit = 25, resumableOnly = false } = {}) {
  const projectDir = projectDirFor(dir);
  let names = [];
  try { names = fs.readdirSync(projectDir); } catch (_) { return []; }

  const found = new Map();
  const note = (id, file, isTranscript) => {
    let st;
    try { st = fs.statSync(file); } catch (_) { return; }
    const prev = found.get(id);
    const entry = prev || { id, at: 0, size: 0, title: '', transcript: false, resumable: false };
    entry.at = Math.max(entry.at, st.mtimeMs);
    if (isTranscript) {
      entry.size = st.size;
      entry.transcript = true;
      // An empty transcript is a session that never got going; --resume finds nothing in it either.
      entry.resumable = st.size > 0;
      entry.title = entry.title || titleOf(file);
    }
    found.set(id, entry);
  };

  for (const name of names) {
    if (name === 'memory') continue;
    if (name.endsWith('.jsonl')) {
      const id = name.slice(0, -'.jsonl'.length);
      if (isSessionId(id)) note(id, path.join(projectDir, name), true);
    } else if (isSessionId(name)) {
      // A session whose transcript has not been written yet — still running, or cut off by a reboot.
      note(name, path.join(projectDir, name), false);
    }
  }

  return [...found.values()]
    .filter((x) => !resumableOnly || x.resumable)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** Does this directory have any session to resume? Cheap enough to ask while drawing a list. */
function hasSessions(dir) {
  try {
    return fs.readdirSync(projectDirFor(dir)).some((n) => isSessionId(n) || (n.endsWith('.jsonl') && isSessionId(n.slice(0, -6))));
  } catch (_) {
    return false;
  }
}

module.exports = { PROJECTS, isSessionId, projectSlug, projectDirFor, sessionsFor, hasSessions, titleOf };
