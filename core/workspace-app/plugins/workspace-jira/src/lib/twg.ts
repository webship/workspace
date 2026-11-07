/**
 * The Jira domain, over the Teamwork Graph CLI (twg): whether twg is usable here, which Jira
 * projects it can see, and which Jira project a workspace project works against. One instance per
 * plugin (a factory over api.lib), shared by the menu, the list and the actions, so they never
 * disagree about the effective project.
 */

import fs from 'fs';
import path from 'path';
import type { PluginLib } from '@webship/workspace-plugin-api';

export interface JiraProject { key: string; name: string }
export interface TwgState { ok: boolean; reason: string }
export interface TwgVersions { running: string; minimum: string }

export default function twg(lib: PluginLib) {
  const { run } = lib;

// A binary check only — login problems surface in job output where they are
// readable. Cached: the answer cannot change without a container rebuild.
//
// It returns a REASON, not just a boolean, because the Jira control used to
// vanish silently: settings.yml full of Jira configuration, no button, and
// nothing anywhere saying the two were unrelated. The reason is what the
// disabled button now carries.
// Where the binary actually is, most specific first. `/host-local-bin/twg` is the host's own bin
// directory bind-mounted into the container, and it is checked BEFORE `/usr/local/bin/twg` because
// the latter is now a wrapper that execs it: asking the wrapper whether twg exists would always say
// yes, on a machine with nothing installed.
const TWG_PATHS = ['/host-local-bin/twg', '/usr/local/bin/twg', `${process.env.HOME}/.local/bin/twg`];
let _twgState: TwgState | null = null;
function twgState(): TwgState {
  if (_twgState) return _twgState;
  let placeholder = false;
  for (const p of TWG_PATHS) {
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) {
      // .ddev/docker-compose.twg.yaml bind-mounts the host's twg into the
      // container, and Docker CREATES a missing bind source as an empty
      // directory — root-owned. So "twg is a directory" means twg was never
      // installed on the host, and that directory will also block installing
      // it to that path later.
      placeholder = true;
      continue;
    }
    if (!st.isFile()) continue;
    try { fs.accessSync(p, fs.constants.X_OK); } catch (_) {
      _twgState = { ok: false, reason: `twg at ${p} is not executable` };
      return _twgState;
    }
    _twgState = { ok: true, reason: '' };
    return _twgState;
  }
  _twgState = { ok: false, reason: placeholder
    ? 'the Teamwork Graph CLI (twg) is not installed on the host — the path is an empty directory Docker created for the bind mount, and it has to be removed before twg can be installed there'
    : 'the Teamwork Graph CLI (twg) is not installed' };
  return _twgState;
}
function twgAvailable() { return twgState().ok; }

// Installed is not signed in, and the gate above cannot tell the difference: it is a
// file check, so the Jira control appears the moment the binary exists and every action
// then fails with AUTH_REQUIRED. That is what the user sees — a button that is offered
// and does not work — so the auth state is carried here too.
//
// It has to be a CACHED ASYNC probe consulted synchronously, because twg keeps no
// credential file to stat (~/.config/twg holds install.json and nothing else; the
// session lives in a keyring) and the page renderers are synchronous. So: `twgAuthProbe`
// refreshes in the background, `twgAuthReason()` answers from the last known result, and
// an unknown state renders as usable — the same behaviour as before, never worse.
const TWG_AUTH_TTL = 5 * 60 * 1000;
let _twgAuth: { at: number; signedIn: boolean | null; running: boolean } = { at: 0, signedIn: null, running: false };
// What the last real call said about the version, or null while nothing has said anything. Unknown
// renders as usable, like the auth probe: a gate that guesses is worse than one that waits.
let _twgStale: TwgVersions | null = null;

// AUTH_REQUIRED as twg reports it. Matched on the CODE and on the sentence, because the
// CLI prints JSON for some verbs and prose for others, and hard-wraps prose to the
// terminal width — so a match on a long phrase can fail on a narrow one.
// twg refusing to run because it is too old, in its own words. It says it on every real command
// ("this CLI is running v1.2.7, below the minimum supported version v1.3.1"), and the server decides
// that minimum — so the version is READ from what twg says rather than pinned here, where it would go
// stale the next time the minimum moves.
function twgUpdateNeeded(text: unknown): TwgVersions | null {
  const t = String(text || '');
  if (!/minimum supported version/i.test(t) && !/update required/i.test(t)) return null;
  const ver = (m: RegExpMatchArray | null) => (m ? m[1].replace(/\.$/, '') : '');
  const running = t.match(/running\s+v?(\d[\d.]*)/i);
  const minimum = t.match(/minimum\s+(?:supported\s+)?version\s+v?(\d[\d.]*)/i);
  return { running: ver(running), minimum: ver(minimum) };
}

/**
 * What to do about it — and the second half is the part that is easy to miss.
 *
 * `twg update` on the host is the fix the CLI names, and on a machine where the dashboard runs in its
 * own container it is only half of one: the container used to bind-mount the BINARY, which binds an
 * inode, so an updated host binary never reached it. That is fixed for new containers (the bin
 * directory is mounted and /usr/local/bin/twg is a wrapper), but a container built before that change
 * still has the old mount and needs one restart to pick it up.
 */
function twgUpdateHint(v: TwgVersions | null): string {
  const versions = v && v.running && v.minimum
    ? `The dashboard is running twg ${v.running}; Jira needs ${v.minimum}. `
    : '';
  return `${versions}On the host, run: twg update.`
    + ' If the dashboard still reports the old version afterwards, run ddev restart in'
    + ' core/workspace-app once — a container created before this fix mounted the binary itself,'
    + ' which pins the file it was started with rather than following an update.';
}

function twgNeedsLogin(text: unknown): boolean {
  const t = String(text || '');
  return /AUTH_REQUIRED/.test(t) || /authentication required/i.test(t) || /not signed in/i.test(t);
}

// The one instruction that fixes it, in the words of the thing that has to be done.
// `twg login` prints a URL and a code (OAuth DEVICE authorization) rather than needing a
// browser on the machine it runs on — worth saying, because this dashboard usually runs
// on a box whose browser is somewhere else.
const TWG_LOGIN_HINT = 'twg is installed but not signed in. On the host, run: twg login --force'
  + ' — it prints a URL and a code, so the browser does not have to be on this machine.'
  + ' The dashboard shares ~/.config/twg, so it picks the session up with no restart.';

async function twgAuthProbe() {
  if (!twgAvailable()) return;
  if (_twgAuth.running) return;
  if (_twgAuth.signedIn !== null && Date.now() - _twgAuth.at < TWG_AUTH_TTL) return;
  _twgAuth.running = true;
  try {
    // The cheapest authenticated call twg has. --limit 1 so a large site costs nothing.
    const out = await run('twg', ['jira', 'space', 'list', '--limit', '1'], process.env.HOME, { timeoutMs: 45 * 1000 });
    const text = `${out.stdout || ''}${out.stderr || ''}`;
    // The same call answers both questions, so being out of date is noticed by the menu rather than
    // only by whoever opens a workitems list and reads the CLI's output at the bottom of it.
    _twgStale = twgUpdateNeeded(text);
    _twgAuth = { at: Date.now(), signedIn: !twgNeedsLogin(text), running: false };
  } catch (_) {
    // A probe that cannot run says nothing: leave the last verdict rather than
    // reporting a login problem for what may be a timeout.
    _twgAuth.running = false;
  }
}

// Synchronous, for the renderers: '' when signed in or not yet known, the hint when the
// last probe said AUTH_REQUIRED. Kicks off a refresh when the answer is stale.
// `twg login` writes its session to ~/.config/twg/auth.conf, which the dashboard shares
// from the host — so ABSENT is a definitive "never signed in" that costs no network and
// is right on the FIRST render. That matters: the async probe answers "unknown" until it
// has run once, and unknown renders as usable, which is exactly the fresh-machine case
// this is here to catch. A present file only means a session was written, not that it is
// still valid, so that case still goes to the probe.
const TWG_SESSION = path.join(process.env.HOME || '', '.config', 'twg', 'auth.conf');
function twgSessionFileExists() {
  try { return fs.statSync(TWG_SESSION).size > 0; } catch (_) { return false; }
}

function twgAuthReason() {
  if (!twgAvailable()) return '';
  // Too old comes first: it is not a login problem, and every other reason is unreachable until it is
  // fixed — twg refuses the command before it ever looks at the session.
  if (_twgStale) return twgUpdateHint(_twgStale);
  if (!twgSessionFileExists()) return TWG_LOGIN_HINT;
  twgAuthProbe().catch(() => {});
  return _twgAuth.signedIn === false ? TWG_LOGIN_HINT : '';
}

/** Is the CLI the dashboard runs too old for Jira? For the caption on the disabled button. */
function twgIsStale() { return !!_twgStale; }

/** A run that reported it: remembered, so the menu says so before anyone opens a list. */
function twgNoteOutput(text: unknown): TwgVersions | null {
  const v = twgUpdateNeeded(text);
  if (v) _twgStale = v;
  return v;
}

// After a successful `twg login` the next page should not wait out the TTL.
function twgAuthForget() { _twgAuth = { at: 0, signedIn: null, running: false }; _twgStale = null; }

// The Jira projects twg can see, as {key, name}, cached for 10 minutes — the
// tasks modal offers them; settings.yml only picks defaults and allowlists.
let _jiraProjects: { at: number; list: JiraProject[] | null } = { at: 0, list: null };
let _jiraProjectsInflight: Promise<unknown> | null = null;

/** What is cached right now, or null: no waiting, for a page that must open at once. */
function jiraProjectListCached(): JiraProject[] | null {
  return _jiraProjects.list && Date.now() - _jiraProjects.at < 10 * 60 * 1000 ? _jiraProjects.list : null;
}

/** Ask for the list in the background and let the next opening find it; one request at a time. */
function warmJiraProjects() {
  if (jiraProjectListCached() || _jiraProjectsInflight) return;
  _jiraProjectsInflight = jiraProjectList().catch(() => null).finally(() => { _jiraProjectsInflight = null; });
}

async function jiraProjectList(): Promise<JiraProject[] | null> {
  if (_jiraProjects.list && Date.now() - _jiraProjects.at < 10 * 60 * 1000) return _jiraProjects.list;
  const out = await run('twg', ['jira', 'space', 'list', '--limit', '100'], process.env.HOME, { timeoutMs: 60 * 1000 });
  let list: JiraProject[] | null = null;
  try {
    const raw = String(out.stdout);
    list = (JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).projects || [])
      .map((p: any) => ({ key: String(p.key || ''), name: String(p.name || '') }))
      .filter((p: JiraProject) => /^[A-Z][A-Z0-9]+$/.test(p.key));
  } catch (_) { list = null; }
  _jiraProjects = { at: Date.now(), list };
  return list;
}

// Which Jira project THIS workspace project works against: its own
// .jira-project file when it carries a valid key, else null (the caller falls
// back to the global default). The file lives in the project root, so clones
// and backups carry it.
function projectJiraKey(projectDir: string): string | null {
  try {
    const k = fs.readFileSync(path.join(projectDir, '.jira-project'), 'utf8').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]+$/.test(k)) return k;
  } catch (_) { /* none set */ }
  return null;
}


/**
 * Post one comment on a workitem, with the twg CLI the rest of this module uses.
 *
 * Markdown, because that is what a person reading a Jira comment should get, and because the body is
 * built here rather than by an agent — nothing in it comes from the workitem or from a model.
 */
async function postComment(key: string, body: string): Promise<{ ok: boolean; error: string }> {
  if (!/^[A-Z][A-Z0-9]+-[0-9]+$/.test(String(key || ''))) return { ok: false, error: 'not a workitem key' };
  const out = await run('twg', ['jira', 'workitem', 'comment', 'create',
    '--issue-id', key, '--body', String(body), '--body-format', 'markdown'],
  process.env.HOME, { timeoutMs: 60 * 1000 });
  const ok = out.code === 0;
  return { ok, error: ok ? '' : String(out.stderr || out.stdout || '').slice(-300) };
}

  return {
    jiraProjectListCached, warmJiraProjects, postComment,
    twgAuthReason, twgAuthProbe, twgAuthForget, twgNeedsLogin, TWG_LOGIN_HINT,
    twgUpdateNeeded, twgUpdateHint, twgIsStale, twgNoteOutput,
    twgState, twgAvailable, jiraProjectList, projectJiraKey,
  };
}
