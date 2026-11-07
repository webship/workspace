/**
 * The Claude Code runs a Jira workitem has had, live and finished.
 *
 * A workitem gets worked more than once — a first pass, a session that was stopped and started again,
 * a second agent after the first was told something it needed. `screen -ls` answers only for the ones
 * still running, and a finished run leaves nothing behind but a log file nobody can map back to a
 * conversation. So each run is noted when it starts, and the notes are what this reads.
 *
 * A note is one small JSON file per screen session, beside the log the session already writes:
 *
 *   ~/workspace/.screens/<session>.run.json
 *   { "key": "WEBSHIP-2199", "project": "dev/v11x00b1gleap", "at": 1758…, "claude": "17e1…" }
 *
 * **The claude id is not known at start.** `exec claude` creates its transcript a second or two later,
 * so the id is filled in by looking for the newest transcript in that directory AFTER the session is
 * up — and left out when none appears, rather than guessed at. An id that belongs to another window
 * would be worse than no id: `claude --resume` would open somebody else's conversation.
 *
 * Nothing here posts anything anywhere. What a run is worth telling Jira is the caller's decision.
 */

import fs from 'fs';
import path from 'path';
import type { PluginLib } from '@webship/workspace-plugin-api';

export interface RunNote { session: string; key: string; project: string; dir: string; at: number; claude: string }
export interface Run extends RunNote { live: boolean }
export interface LiveSession { session: string; state?: string }

export default function sessions(lib: PluginLib) {
  const { ROOT } = lib;

const STORE = () => path.join(ROOT, '.screens');
const noteFile = (session: string) => path.join(STORE(), `${session}.run.json`);

/** The workitem a session name carries, if it carries one: `dev--blog1--jira-webship-2199`. */
function keyOfSession(session: unknown): string {
  const m = String(session || '').match(/--jira-([a-z][a-z0-9]*-[0-9]+)(?:--|$)/i);
  return m ? m[1].toUpperCase() : '';
}

/**
 * The newest Claude transcript in a directory, when one appeared after `since`.
 *
 * `since` is what makes this honest: a project that has been worked before already has transcripts,
 * and the newest of those belongs to the LAST run, not to the one just started. Only a transcript
 * written after the session came up can be this session's.
 */
function claudeIdFor(dir: string, since: number): string {
  if (!dir) return '';
  try {
    const [latest] = lib.claudeSessionsFor(dir, { limit: 1 }) as any[];
    if (!latest) return '';
    const at = Number(latest.at || 0);
    return at && at >= since - 2000 ? latest.id : '';
  } catch (_) {
    return '';
  }
}

/** Write the note for a run that has just started. Returns what was written. */
function recordRun(session: string, { key, workspace, project, dir }: { key: string; workspace?: string; project?: string; dir?: string }): Omit<RunNote, 'session'> {
  const note = {
    key: String(key || '').toUpperCase(),
    project: [workspace, project].filter(Boolean).join('/'),
    dir: dir || '',
    at: Date.now(),
    claude: '',
  };
  try {
    fs.mkdirSync(STORE(), { recursive: true });
    fs.writeFileSync(noteFile(session), JSON.stringify(note));
  } catch (_) { /* a run with no note still runs */ }
  return note;
}

/**
 * Fill in the claude id once the transcript exists, giving it a few seconds to appear.
 *
 * Polled rather than waited on: there is no event for "claude has written its first line", and the
 * caller is answering a click. It gives up quietly — a note without an id still says a run happened,
 * which is most of what the list is for.
 */
async function fillClaudeId(session: string, dir: string, { tries = 6, waitMs = 700 } = {}): Promise<string> {
  let note: any;
  try { note = JSON.parse(fs.readFileSync(noteFile(session), 'utf8')); } catch (_) { return ''; }
  for (let i = 0; i < tries; i += 1) {
    const id = claudeIdFor(dir, note.at);
    if (id) {
      note.claude = id;
      try { fs.writeFileSync(noteFile(session), JSON.stringify(note)); } catch (_) { /* best effort */ }
      return id;
    }
    await new Promise((r) => { setTimeout(r, waitMs); });
  }
  return '';
}

/** One run, as the page and the comment both want it. */
function readNote(session: string): RunNote | null {
  try {
    const n = JSON.parse(fs.readFileSync(noteFile(session), 'utf8'));
    return { session, ...n };
  } catch (_) {
    return null;
  }
}

/**
 * Every recorded run of one workitem, newest first, each saying whether it is still live.
 *
 * Live is asked of the sessions passed in rather than looked up here, so the caller makes one
 * `screen -ls` for a page of workitems instead of one per row.
 */
function runsFor(key: unknown, liveSessions: LiveSession[] = []): Run[] {
  const want = String(key || '').toUpperCase();
  if (!want) return [];
  const live = new Set(liveSessions.filter((s) => !/dead/i.test(s.state || '')).map((s) => s.session));
  let files = [];
  try { files = fs.readdirSync(STORE()).filter((f) => f.endsWith('.run.json')); } catch (_) { return []; }
  const runs: Run[] = [];
  for (const f of files) {
    const note = readNote(f.replace(/\.run\.json$/, ''));
    if (!note || note.key !== want) continue;
    runs.push({ ...note, live: live.has(note.session) });
  }
  // A session that is running but was never noted still belongs in the list: the note is a
  // convenience, and a run this dashboard did not start is still a run of this workitem.
  for (const s of liveSessions) {
    if (/dead/i.test(s.state || '')) continue;
    if (keyOfSession(s.session) !== want) continue;
    if (runs.some((r) => r.session === s.session)) continue;
    runs.push({ session: s.session, key: want, project: '', dir: '', at: 0, claude: '', live: true });
  }
  return runs.sort((a, b) => (Number(b.live) - Number(a.live)) || (b.at - a.at));
}

  return { keyOfSession, recordRun, fillClaudeId, readNote, runsFor, claudeIdFor, noteFile };
}
