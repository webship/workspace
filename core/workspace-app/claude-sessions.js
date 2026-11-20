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
 * /home/user/workspace/dev/ha1x00b1 is -home-user-workspace-dev-ha1x00b1.
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

/** Where the CLI keeps one conversation of a folder, or '' for an id that is not one. */
function transcriptFile(dir, id) {
  return isSessionId(id) && dir ? path.join(projectDirFor(dir), `${String(id).toLowerCase()}.jsonl`) : '';
}

/**
 * The records the CLI itself wraps into a user line: reminders, a command's output, what an editor had open. They
 * are not what anyone typed. Named one by one, because a person may type a tag of their own and that is kept.
 */
const CLI_WRAPPERS = ['system-reminder', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat',
  'command-message', 'bash-stdout', 'bash-stderr', 'user-prompt-submit-hook', 'ide_opened_file', 'ide_selection',
  'ide_diagnostics', 'task-notification'];
const WRAPPED = new RegExp(`<(${CLI_WRAPPERS.join('|')})>[\\s\\S]*?<\\/\\1>`, 'g');

/** What was typed, out of a user line: a slash command as its name and arguments, a shell line as `! <line>`. */
function typedText(text) {
  const s = String(text || '');
  const name = (s.match(/<command-name>([\s\S]*?)<\/command-name>/) || [])[1];
  if (name) {
    const args = (s.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    return `${name.trim()} ${args.trim()}`.trim();
  }
  const shell = (s.match(/<bash-input>([\s\S]*?)<\/bash-input>/) || [])[1];
  if (shell) return `! ${shell.trim()}`;
  return s.replace(WRAPPED, '').trim();
}

/** One tool call, as a line: its name, and the part of its input that says what it was for. */
function toolLine(part) {
  const input = (part && part.input) || {};
  const what = ['description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt']
    .map((k) => input[k]).find((v) => typeof v === 'string' && v.trim()) || '';
  const name = String((part && part.name) || 'tool');
  return what ? `${name} · ${what.replace(/\s+/g, ' ').trim().slice(0, 160)}` : name;
}

/**
 * A conversation as a person reads it back: what was typed, what was answered, and the tools used in between.
 *
 * Read from the transcript the CLI keeps, which is UNTRUSTED text: anything can be in it, typed by a person, written
 * by a model or pasted from a page. So this returns plain strings and never markup; whoever shows them escapes them.
 * The model's thinking, tool results and the CLI's own records stay out. Read from the end and bounded, because the
 * transcript of a long day runs to tens of megabytes and this answers one click.
 */
function readConversation(file, { maxBytes = 4 * 1024 * 1024, limit = 60 } = {}) {
  let text = '';
  let cut = false;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - maxBytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
      // Started in the middle of a line: that line is not a record.
      if (start > 0) { cut = true; text = text.slice(text.indexOf('\n') + 1); }
    } finally { fs.closeSync(fd); }
  } catch (_) {
    return { turns: [], total: 0, cut: false, missing: true };
  }
  const turns = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let d;
    try { d = JSON.parse(line); } catch (_) { continue; }
    if (!d || (d.type !== 'user' && d.type !== 'assistant')) continue;
    // A subagent's own exchange, the CLI's injected context, and a compacted summary are not the conversation.
    if (d.isSidechain || d.isMeta || d.isCompactSummary) continue;
    const content = d.message && d.message.content;
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const at = Date.parse(d.timestamp || '') || 0;
    const said = parts.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join('\n');
    if (d.type === 'user') {
      // The CLI handing a tool's answer back to the model is not something anyone typed.
      if (parts.some((p) => p && p.type === 'tool_result')) continue;
      const typed = typedText(said);
      if (typed) turns.push({ who: 'you', text: typed, tools: [], at });
    } else {
      const tools = parts.filter((p) => p && p.type === 'tool_use').map(toolLine);
      const answer = said.trim();
      if (answer || tools.length) turns.push({ who: 'claude', text: answer, tools, at });
    }
  }
  return { turns: limit ? turns.slice(-limit) : turns, total: turns.length, cut, missing: false };
}

module.exports = { PROJECTS, isSessionId, projectSlug, projectDirFor, sessionsFor, hasSessions, titleOf, transcriptFile, readConversation };
