/**
 * The screen-sessions domain: what is running detached on this machine, and
 * where a session's log lives when the dashboard knows the convention. The
 * watch/stop actions live in actions/screens.js; the Screens modal, the
 * /settings/screens page and the rail badge all read the same list.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { run } = require('./jobs');
const { ROOT, loadWorkspaces } = require('./workspaces');
const { esc } = require('./html');
const { tildePath } = require('./format');
const { waitingState } = require('./waiting');
const claudeSessions = require('./claude-sessions');
const claudeArgs = require('./claude-args');

/** Live screen sessions: the host's when its runner is up, this container's
 *  otherwise. Each row says where it lives, because `screen -r` in a terminal
 *  only reaches the host ones. */
/** Every session runs on the machine. Two ways to see them, and both are used:
 *  screen(1) itself, through the socket directory mounted in here — which is
 *  also how the browser terminal attaches — and the runner's published list,
 *  which still answers when that mount is missing. */
async function listScreens() {
  const { hostSessionsFile } = require('./jobs');
  const rows = (await listContainerScreens()).map((s) => ({ ...s, where: 'host' }));
  const seen = new Set(rows.map((s) => s.session));
  const published = hostSessionsFile();
  const pubRows = published && Array.isArray(published.sessions) ? published.sessions : [];
  // The waiting flag is computed by the HOST runner (it reads each session's visible
  // screen), so it only ever arrives on the published rows. It has to be MERGED onto the
  // rows this side already knows about rather than used only for the ones it does not:
  // `screen -ls` here lists the same sessions, those rows won, and the flag was dropped
  // every time — the badge could not appear for any session that was already listed,
  // which is all of them.
  const pubBy = new Map(pubRows.map((s) => [s.session, s]));
  for (const r of rows) {
    const p = pubBy.get(r.session);
    if (p && p.waiting !== undefined) { r.waiting = p.waiting; r.waitingWhy = p.waitingWhy; }
  }
  const extra = pubRows.filter((s) => !seen.has(s.session)).map((s) => ({ ...s, where: 'host' }));
  return rows.concat(extra);
}

/** The sessions inside this container. */
async function listContainerScreens() {
  const out = String((await run('screen', ['-ls'], process.env.HOME, { timeoutMs: 10 * 1000 })).stdout || '');
  const rows = [];
  for (const line of out.split('\n')) {
    // `screen -ls` prints:  \t<pid>.<name>\t(<date>)\t(<state>)
    const m = line.match(/^\s+(\d+)\.(\S+)\s+\(([^)]*)\)(?:\s+\(([^)]*)\))?/);
    if (m) rows.push({ pid: m[1], session: m[2], started: m[3], state: m[4] || '' });
  }
  return rows;
}

// Where a session's log lives, when the dashboard knows the convention:
// jira-<key> logs sit in the project that ran the agent; generic runs log
// under ~/.workspace-screens/<session>.log. Unknown sessions return null —
// they can still be stopped or reattached, just not tailed.
function screenLogFor(session) {
  // This workspace's own log store first; the old shared home location stays
  // readable so sessions started before the move keep their Watch.
  for (const dir of [path.join(ROOT, '.screens'), path.join(process.env.HOME, '.workspace-screens')]) {
    const f = path.join(dir, `${session}.log`);
    if (fs.existsSync(f)) return f;
  }
  const m = session.match(/(?:^|--)jira-([a-z0-9]+-[0-9]+)$/);
  if (m) {
    const key = m[1].toUpperCase();
    for (const ws of Object.values(loadWorkspaces())) {
      if (ws.kind === 'files') continue;
      try {
        for (const p of fs.readdirSync(ws.dir)) {
          const f = path.join(ws.dir, p, `.jira-${key}.log`);
          if (fs.existsSync(f)) return f;
        }
      } catch (_) { /* skip */ }
    }
  }
  return null;
}

/** The session list, shared by the Screens modal and /settings/screens. */
// A session that has stopped to ask something. There is no API for "the program
// is waiting" — the truth is in what it last printed, so this reads the tail and
// looks for the shapes a question takes. It is a hint, never a claim: false
// positives cost a badge, false negatives cost nothing that was not already so.
const WAITING_PATTERNS = [
  /\?\s*$/,                                   // a question, still on the last line
  /\((?:y\/n|yes\/no|Y\/n|y\/N)\)\s*[:?]?\s*$/i,
  /\b(?:do you want|would you like|proceed\?|continue\?|are you sure)\b/i,
  /\b(?:press|type)\b[^\n]{0,40}\b(?:enter|any key|to continue)\b/i,
  /\b(?:waiting for|awaiting)\b[^\n]{0,30}\b(?:input|confirmation|approval|response)\b/i,
  /^\s*[❯>]\s*\d+\.\s/m,                     // a numbered choice list, Claude Code style
  /\b(?:allow|approve|permission)\b[^\n]{0,40}\?/i,
  /passphrase|password\s*[:?]\s*$/i,
];

function sessionNeedsInput(session) {
  const log = screenLogFor(session);
  if (!log) return false;
  let tail = '';
  try {
    const fd = fs.openSync(log, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 3000);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    tail = buf.toString('utf8');
  } catch (_) { return false; }
  // Only what it printed LAST matters: a question answered ten minutes ago is
  // not a question now.
  const lines = tail.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split('\n').filter((l) => l.trim());
  const recent = lines.slice(-6).join('\n');
  return WAITING_PATTERNS.some((re) => re.test(recent));
}

/**
 * Which sessions have an AGENT running in them — Claude Code, rather than a shell or a command.
 *
 * Asked of the process table, not of the session's name and not of a note written when it started:
 * a session can be started from the dashboard, from `cmd-tools-screen.sh`, or by hand in a terminal,
 * and only the first of those could ever have left a marker behind. What is actually running inside it
 * is the same question however it was started.
 *
 * One `ps` for the whole page — a workspace page renders twenty rows and each asks — memoised for a
 * few seconds, which is far shorter than the fifteen the rows poll on. The SNAPSHOT is what is kept,
 * never the answer: see processTable.
 *
 * It walks DOWN from each session's own screen process: `screen` forks the command, and a Claude Code
 * session is `exec claude …`, so the agent is a descendant rather than the screen process itself.
 */
let psMemo = { at: 0, kids: new Map(), args: new Map() };

/**
 * The process table, as a parent → children map and a pid → command line map.
 *
 * The SNAPSHOT is what is memoised, never the answer computed from it. Caching the answer was wrong in
 * a way that looked right on the page that found it: the first project to ask filled the cache, and
 * every other row within the next few seconds got that project's set back — so on a workspace of
 * eleven projects, ten of them claimed an agent was running that belonged to the first one.
 */
function processTable() {
  const now = Date.now();
  if (now - psMemo.at < 5000) return psMemo;
  const kids = new Map();
  const args = new Map();
  try {
    const out = require('child_process').execFileSync('ps', ['-eo', 'pid=,ppid=,args='],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const [, pid, ppid, cmd] = m;
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(pid);
      args.set(pid, cmd);
    }
  } catch (_) { /* no ps, no claim */ }
  psMemo = { at: now, kids, args };
  return psMemo;
}

// `claude` the CLI, never a path that merely mentions it: a shell sitting in a folder called
// claude-something is not an agent, and neither is `tail -F .../claude.log`.
const isClaudeCmd = (cmd) => /(^|\/)claude(\s|$)/.test(String(cmd || '').trim());

function agentSessions(sessions) {
  const { kids, args } = processTable();
  const found = new Set();
  for (const s of sessions || []) {
    const seen = new Set();
    // Never walk from 0: every top-level process has ppid 0, so a row with no pid — a session the
    // runner published that `screen -ls` has not listed yet — would walk the whole machine and claim
    // every agent on it as its own.
    const root = String(s.pid || '');
    if (!root || root === '0') continue;
    const stack = [root];
    while (stack.length) {
      const pid = stack.pop();
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      if (isClaudeCmd(args.get(pid))) { found.add(s.session); break; }
      (kids.get(pid) || []).forEach((k) => stack.push(k));
    }
  }
  return found;
}

/**
 * Is this session waiting for a person, and what for?
 *
 * The runner's answer FIRST, and the log's only after it. The runner publishes what it read from the
 * session's own VISIBLE SCREEN, which is the only thing that works for an agent: a Claude Code session
 * runs `exec claude` with no `tee` — piping a full-screen TUI gives garbage — so its `.log` is zero
 * bytes and the log check below can never fire for exactly the sessions where "it stopped to ask you
 * something" matters most.
 *
 * One function because three places ask: the Screens page, the project row on a workspace page, and the
 * count in the top bar. Three copies of this rule would be three answers to one question.
 */
function sessionWaitingWhy(s) {
  if (!s) return '';
  if (s.waiting) return s.waitingWhy || 'waiting for you';
  return sessionNeedsInput(s.session) ? 'waiting for you' : '';
}

/** The last stretch of a session's log, as a terminal pane body. */
function screenTailHtml(session) {
  const log = screenLogFor(session);
  if (!log) return '<span class="uk-text-meta">No known log for this session — reattach in a terminal.</span>';
  let text = '';
  try {
    const fd = fs.openSync(log, 'r');
    const size = fs.fstatSync(fd).size;
    const want = 4000;
    const start = Math.max(0, size - want);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  } catch (_) { return '<span class="uk-text-meta">The log is not readable yet.</span>'; }
  return esc(text || '(no output yet)');
}

// Where a new session can run: the workspace root, any workspace folder, and
// any project inside one. The value is a token the action resolves back to a
// directory — never a path from the browser.
function screenTargets() {
  const targets = [{ value: 'root', label: 'Workspace root', dir: ROOT }];
  for (const [key, meta] of Object.entries(loadWorkspaces())) {
    targets.push({ value: `ws:${key}`, label: `${key}/`, dir: meta.dir, group: 'Workspace folders' });
    if (meta.kind === 'files') continue;
    let entries = [];
    try { entries = fs.readdirSync(meta.dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      targets.push({ value: `p:${key}:${e.name}`, label: `${key}/${e.name}`, dir: path.join(meta.dir, e.name), group: 'Projects' });
    }
  }
  return targets;
}

/** The directory a target token means, or null when it names nothing real. */
function screenTargetDir(value) {
  const t = screenTargets().find((x) => x.value === String(value || ''));
  return t && fs.existsSync(t.dir) ? t.dir : null;
}

/**
 * The sessions a target directory can resume, as a select. Empty when there are none — a first session
 * in a project has nothing to resume, and an empty control there would be a question with no answers.
 */
function claudeResumeHtml(target) {
  const dir = screenTargetDir(target);
  // Only what --resume can actually open. An id with no transcript answers "No conversation found with
  // session ID" and the screen dies in the same second — offering one is offering a dead end.
  const sessions = dir ? claudeSessions.sessionsFor(dir, { limit: 25, resumableOnly: true }) : [];
  const openOnes = dir ? claudeSessions.sessionsFor(dir).filter((x) => !x.resumable).length : 0;
  if (!sessions.length) {
    return `<div class="uk-text-meta">No Claude session to resume in ${dir ? `<code>${esc(tildePath(dir))}</code>` : 'that place'} yet — this starts a new one.${
      openOnes ? ` (${openOnes} session${openOnes === 1 ? ' has' : 's have'} no transcript written yet, so <code>--resume</code> cannot open ${openOnes === 1 ? 'it' : 'them'}.)` : ''}</div>`;
  }
  const when = (ms) => {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  };
  // A checkbox, because resuming is the exception and starting fresh is the default — and because the
  // answer to "which one" is almost always the newest, which is what the list opens on.
  return `<div class="claude-resume">
    <label class="uk-text-meta claude-resume-on">
      <input class="uk-checkbox" type="checkbox" name="resume_on" value="1"
             onchange="var s=this.closest('.claude-resume').querySelector('select[name=resume]');s.disabled=!this.checked;">
      Resume a Claude session in <code>${esc(tildePath(dir))}</code>
      <span class="uk-text-meta">· ${sessions.length} to pick from${openOnes ? `, ${openOnes} with no transcript yet` : ''}</span>
    </label>
    <select class="uk-select uk-form-small" name="resume" disabled aria-label="Claude conversation to resume"
            title="claude --resume &lt;id&gt; — picks that exact conversation back up, in this directory">
      ${sessions.map((x, i) => `<option value="${esc(x.id)}"${i === 0 ? ' selected' : ''}>${esc(when(x.at))} · ${esc(x.title || (x.transcript ? 'no first message' : 'no transcript written yet'))} · ${esc(x.id.slice(0, 8))}</option>`).join('')}
    </select>
  </div>`;
}

// The reusable prompts in the prompts workspace, offered as starting text.
// ITEM_RESERVED_FILES-style folder docs (AGENTS.md, CLAUDE.md, README.md) are
// not prompts.
function promptTemplates() {
  const dir = path.join(ROOT, 'ai-prompts');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !/^(AGENTS|CLAUDE|README)\.md$/.test(f))
      .sort();
  } catch (_) { return []; }
}

/** The sessions running in a directory: the .cwd note each start leaves, plus
 * the jira-<key> convention whose log lives inside the project itself. */
async function screensForDir(dir) {
  const live = await listScreens();
  const store = path.join(ROOT, '.screens');
  return live.filter((s) => {
    try {
      if (fs.readFileSync(path.join(store, `${s.session}.cwd`), 'utf8').trim() === dir) return true;
    } catch (_) { /* no note */ }
    const m = s.session.match(/(?:^|--)jira-([a-z0-9]+-[0-9]+)/);
    if (m) return fs.existsSync(path.join(dir, `.jira-${m[1].toUpperCase()}.log`));
    return false;
  });
}

/**
 * What is running in each project: how many screen sessions, how many of those have an agent inside,
 * and how many are waiting on a person.
 *
 * One answer for a whole table of rows, asked once — the project list filters and sorts on it, and a
 * per-row `screensForDir` would be one `screen -ls` per project. A session belongs to a project by the
 * same two rules `screensForDir` uses (the .cwd note a start leaves, then the jira log inside the
 * project), and the agent test is `agentSessions`, so a project that passes the filter is one whose
 * row badges say so. A dead session (screen -ls still lists it) is not running anything.
 *
 * `activityFromSessions` is the pure half, so the counting can be tested without screen or ps.
 */
function activityFromSessions(sessions, { agents, dirOf }) {
  const out = new Map();
  for (const s of sessions || []) {
    if (/dead/i.test(s.state || '')) continue;
    const dir = dirOf(s.session);
    if (!dir) continue;
    const a = out.get(dir) || { screens: 0, agents: 0, waiting: 0 };
    a.screens += 1;
    if (agents.has(s.session)) a.agents += 1;
    if (sessionWaitingWhy(s)) a.waiting += 1;
    out.set(dir, a);
  }
  return out;
}

async function activityByDir(dirs) {
  const sessions = await listScreens();
  if (!sessions.length) return new Map();
  const store = path.join(ROOT, '.screens');
  const known = new Set(dirs);
  const dirOf = (session) => {
    try {
      const d = fs.readFileSync(path.join(store, `${session}.cwd`), 'utf8').trim();
      if (known.has(d)) return d;
    } catch (_) { /* no note */ }
    const m = session.match(/(?:^|--)jira-([a-z0-9]+-[0-9]+)/);
    if (m) return dirs.find((d) => fs.existsSync(path.join(d, `.jira-${m[1].toUpperCase()}.log`))) || '';
    return '';
  };
  return activityFromSessions(sessions, { agents: agentSessions(sessions), dirOf });
}

/** The claude flags a template's own command carries (kept, not invented). */
function promptTemplateFlags(file) {
  if (!promptTemplates().includes(file)) return '';
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, 'ai-prompts', file), 'utf8'); } catch (_) { return ''; }
  const m = raw.match(/^\s*claude\s+([^\n]*?)\s*"""\s*$/m);
  return m ? m[1].trim() : '';
}

// One template, as the text Claude Code should actually open with. Every
// prompt in that folder is written as the whole launch command —
// `claude --permission-mode bypassPermissions """<prompt>"""` inside a fence —
// so the wrapper is peeled off here: the form runs claude itself, and the
// user should see the prompt, not the command that would start it.
function promptTemplateText(file) {
  if (!promptTemplates().includes(file)) return null;
  let raw;
  try { raw = fs.readFileSync(path.join(ROOT, 'ai-prompts', file), 'utf8'); } catch (_) { return null; }
  const m = raw.match(/claude[^\n]*"""\n([\s\S]*?)\n"""/);
  if (m) return m[1];
  // No wrapper: drop YAML frontmatter and the description line, keep the body.
  const noFm = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  return noFm.trim();
}

function newScreenButtonHtml() {
  return `<button class="uk-button uk-button-primary uk-button-small"
    hx-get="/fragments/screen-new-form" hx-target="#editor-modal-body" hx-swap="innerHTML"
    hx-on::after:request="UIkit.modal('#editor-modal').show()">
    <span uk-icon="icon: plus-circle; ratio: .8"></span> New screen</button>`;
}

/**
 * Where a session can start, as two lists instead of one.
 *
 * It used to be a single select of 309 entries — every workspace folder and every project in the tree,
 * one flat list to scroll. Choosing the workspace first turns that into a list of 22 and then a list of
 * the projects in it, which is also how somebody thinks about where they are going.
 */
function workspaceOptionsHtml(chosen) {
  const rows = [['root', 'Workspace root']];
  for (const [key, meta] of Object.entries(loadWorkspaces())) rows.push([key, `${key}/`, meta.label]);
  return rows.map(([value, label, title]) =>
    `<option value="${esc(value)}"${value === chosen ? ' selected' : ''} title="${esc(title || label)}">${esc(label)}</option>`).join('');
}

/** Which workspace a target token belongs to, so reopening the form lands on the list it was picked from. */
function workspaceOfTarget(target) {
  const t = String(target || '');
  const m = t.match(/^p:([a-z0-9_-]+):/) || t.match(/^ws:([a-z0-9_-]+)$/);
  return m ? m[1] : 'root';
}

/**
 * The places inside one workspace: the folder itself first, then its projects. The folder is a place a
 * session runs in its own right — a whole workspace is what a build, a sweep or a review is about — so
 * it is the first option rather than something to notice is missing.
 */
function targetOptionsHtml(workspace, chosen) {
  const key = String(workspace || 'root');
  if (key === 'root') {
    return `<option value="root" data-path="${esc(tildePath(ROOT))}" selected>the workspace root</option>`;
  }
  const inside = screenTargets().filter((t) => t.value === `ws:${key}` || t.value.startsWith(`p:${key}:`));
  return inside.map((t) => {
    const folder = t.value === `ws:${key}`;
    const label = folder ? `the ${key}/ folder itself` : t.label.slice(key.length + 1);
    // Each option carries where it is, so the line under the select follows the choice with no request.
    return `<option value="${esc(t.value)}" data-path="${esc(tildePath(t.dir))}"${t.value === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

/**
 * The name a session gets by default: where it runs, and a short id so it is its own.
 *
 * The place is what `screen -ls` shows and what `screen -r` takes, so the answer is almost always
 * `dev--ha1x00b1--`; typing that out for every session was busywork with one right answer. The id on the
 * end is what makes it startable twice — a second session in the same project used to be refused with
 * "a session called that is already running", which is a naming collision presented as a rule.
 *
 * Four hex characters: enough that two sessions in one place do not collide, short enough to type after
 * `screen -r`. The caller may pass its own id, which is what makes this testable.
 */
function shortId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 4);
}

function defaultSessionName(target, id) {
  const tail = id || shortId();
  const t = String(target || '');
  const pm = t.match(/^p:([a-z0-9_-]+):(.+)$/);
  // The same shape the session gets when it starts, so the workspace and the project are not said twice.
  if (pm) return `${pm[1]}--${pm[2]}--${tail}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
  const wm = t.match(/^ws:([a-z0-9_-]+)$/);
  if (wm) return `${wm[1]}--${tail}`;
  // The whole tree, which is a place but not a word anyone would name a session: `screen -ls` showing
  // "root" reads as the user it runs as, which it is not.
  return `workspace-${tail}`;
}

/** The "where it runs" half of the form, reloaded whole when the workspace changes. */
function screenWhereHtml(workspace, target) {
  const ws = String(workspace || 'root');
  const options = targetOptionsHtml(ws, target);
  const first = (options.match(/value="([^"]*)"/) || [])[1] || 'root';
  const picked = options.includes(`value="${target}"`) ? target : first;
  const dir = screenTargetDir(picked);
  return `<select class="uk-select uk-form-small" name="target" id="screen-target"
        title="The directory the session starts in"
        hx-get="/fragments/claude-sessions" hx-trigger="change" hx-include="closest form"
        hx-target="#claude-resume-row" hx-swap="innerHTML"
        hx-on::after:request="event.stopPropagation()"
        onchange="window.screenNameFollowsTarget && window.screenNameFollowsTarget(this.form)">${options}</select>
      <div class="uk-text-meta screen-where-path"><code>${dir ? esc(tildePath(dir)) : 'nothing there'}</code></div>`;
}

/** One Claude Code option, as the control its own shape asks for. */
function claudeArgFieldHtml(opt, value, suggestions, asSelect = false) {
  const field = claudeArgs.fieldName(opt.name);
  const id = `arg-${field}`;
  const hint = esc(opt.description);
  if (opt.takes === 'none') {
    return `<label class="claude-arg claude-arg-flag" title="${hint}">
      <input class="uk-checkbox" type="checkbox" name="${field}" value="1"${value ? ' checked' : ''}>
      <code>${esc(opt.name)}</code>
      <span class="claude-arg-help">${hint}</span>
    </label>`;
  }
  // Three shapes, one per kind of answer the option has:
  //
  //   - a CLOSED list (--effort: low, medium, high, xhigh, max) is a select. The CLI names all five.
  //   - an OPEN list (--model, --agent) is an input with a datalist: a dropdown you can also type
  //     into. A select here would refuse every model released after this help text was read, and
  //     every agent that comes from a plugin or a directory this does not walk.
  //   - anything else is a plain field, as before.
  const list = suggestions && suggestions.length ? `${id}-list` : '';
  // A plain list of what is installed, for a form that wants a pick rather than a type-ahead.
  const pickList = asSelect && suggestions && suggestions.length;
  const control = pickList
    ? `<select class="uk-select uk-form-small" name="${field}" id="${id}">
        <option value="">None</option>
        ${suggestions.map((c) => `<option value="${esc(c)}"${String(value) === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select>`
    : opt.choices.length
    ? `<select class="uk-select uk-form-small" name="${field}" id="${id}">
        <option value="">—</option>
        ${opt.choices.map((c) => `<option value="${esc(c)}"${String(value) === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
      </select>`
    : `<input class="uk-input uk-form-small" name="${field}" id="${id}" value="${esc(value || '')}"
         ${list ? `list="${list}"` : ''} placeholder="${esc(opt.placeholder || '')}${opt.repeatable ? ' — space separated' : ''}">${
  list ? `<datalist id="${list}">${suggestions.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>` : ''}`;
  return `<div class="claude-arg" title="${hint}">
    <label class="claude-arg-name" for="${id}"><code>${esc(opt.name)}</code></label>
    ${control}
    <span class="claude-arg-help">${hint}</span>
  </div>`;
}

/**
 * The Claude Code arguments, from the CLI's own --help rather than from a list kept here by hand.
 *
 * The four reached for every time are laid out first; the rest are behind a disclosure, so the form
 * opens as a few controls rather than as forty. The free-text "more claude options" box this replaces
 * meant knowing the flags by heart and typing them with no check at all until the screen either started
 * or died.
 */
/*
 * The Jira checkbox, explained here rather than as an HTML comment inside the markup.
 *
 * A comment that starts on the same line as the backtick opening a nested template literal is exactly
 * where a stray backtick later would be invisible — the repo has a test for the shape, and it caught
 * this one. The rule it enforces is worth keeping: prose about markup belongs in JS, not in the HTML.
 *
 * What the checkbox is: a run started FROM a workitem can say so ON the workitem. Unticked when the
 * form opens, because a Jira comment is visible to everyone on it and a run meant to stay quiet must
 * not become public as a side effect of starting it. The label names exactly what is posted, because
 * "comment the session" could be read as the transcript, and it never is — only where the session is
 * and how to reach it.
 */

async function claudeArgsHtml(pre) {
  const p = pre || {};
  const { options, error } = await claudeArgs.claudeOptions();
  if (error) {
    return `<div class="uk-text-meta">The Claude Code options could not be read from <code>claude --help</code> on this machine (${esc(error.slice(0, 120))}), so only the prompt and the resume list are offered.</div>`;
  }
  const byName = new Map(options.map((o) => [o.name, o]));
  const valueOf = (opt) => {
    const posted = p[claudeArgs.fieldName(opt.name)];
    if (posted !== undefined) return posted;
    // The permission mode used to be its own field, and a prompt template still names one.
    if (opt.name === '--permission-mode') return p.permission_mode || 'bypassPermissions';
    return '';
  };
  // What to suggest for the two options whose values are a list of real things rather than a fixed set:
  // the agents this machine (and this project) actually have, and the model aliases the CLI's own help
  // names. `--agent`'s parsed suggestion is the word "agent" — the quoted setting name in its
  // description — which is why the agents come from the files instead.
  const agents = claudeArgs.installedAgents(screenTargetDir(p.target));
  const suggestionsFor = (opt) => (opt.name === '--agent' ? agents : (opt.suggestions || []));
  const common = claudeArgs.COMMON.map((n) => byName.get(n)).filter(Boolean);
  const rest = options.filter((o) => !claudeArgs.COMMON.includes(o.name));
  return `<div class="claude-args">
    <div class="claude-args-common">${common.map((o) => claudeArgFieldHtml(o, valueOf(o), suggestionsFor(o), !!p.agentSelect && o.name === '--agent')).join('')}</div>
    <details class="claude-args-all">
      <summary>All Claude Code options (${rest.length})</summary>
      <p class="uk-text-meta">Read from <code>claude --help</code> on this machine, so this list is whatever
        the installed CLI actually accepts. The ones that only work with <code>--print</code>, the ones that
        start the session somewhere else, and the ones this form already asks about are not here.</p>
      <div class="claude-args-grid">${rest.map((o) => claudeArgFieldHtml(o, valueOf(o), suggestionsFor(o))).join('')}</div>
    </details>
  </div>`;
}

async function newScreenFormHtml(pre) {
  const p = pre || {};
  const ws = p.workspace || workspaceOfTarget(p.target);
  // Opened on a workspace's own address, the workspace is not a question: asking it again is how a screen
  // started on dev.workspace.ddev.site ended up in the root.
  const locked = !!p.hostWorkspace && p.hostWorkspace === ws;
  const isClaude = p.kind === 'claude';
  const prefilled = defaultSessionName(p.target);
  const kind = (value, label, help) => `<label class="screen-kind${(p.kind || 'shell') === value ? ' is-on' : ''}">
      <input type="radio" name="kind" value="${value}"${(p.kind || 'shell') === value ? ' checked' : ''}
             onchange="window.screenKindChanged && window.screenKindChanged(this.form)">
      <strong>${label}</strong><span class="uk-text-meta">${help}</span>
    </label>`;
  return `
    <div class="editor-card new-screen-card">
      <div class="modal-head">
        <h3 class="uk-margin-small-bottom">New screen</h3>
        <p class="uk-text-meta uk-margin-small-bottom">It runs detached on your machine and survives this
          dashboard restarting; <code>screen -r &lt;name&gt;</code> in your own terminal reattaches to it.</p>
      </div>
      <form hx-post="/actions/screen-new" hx-target="#webship-workspace-projects" hx-swap="innerHTML"
            hx-on::after:request="UIkit.modal('#editor-modal').hide()">

        <fieldset class="screen-step">
          <legend>Where it runs${locked ? ` <span class="uk-text-meta">in the <strong>${esc(ws)}/</strong> workspace</span>` : ''}</legend>
          <div class="uk-grid-small uk-child-width-1-2@s" uk-grid>
            ${locked ? `<input type="hidden" name="workspace" value="${esc(ws)}">` : `<div>
              <label class="uk-form-label" for="screen-workspace">Workspace</label>
              <select class="uk-select uk-form-small" name="workspace" id="screen-workspace"
                      hx-get="/fragments/screen-where" hx-include="closest form"
                      hx-target="#screen-where" hx-swap="innerHTML"
                      hx-on::after:request="event.stopPropagation()">
                ${workspaceOptionsHtml(ws)}
              </select>
            </div>`}
            <div id="screen-where"${locked ? ' class="uk-width-1-1"' : ''}>
              <label class="uk-form-label" for="screen-target">Folder or project</label>
              ${screenWhereHtml(ws, p.target)}
            </div>
          </div>
        </fieldset>

        <fieldset class="screen-step">
          <legend>What it starts</legend>
          <div class="screen-kinds">
            ${kind('shell', 'Shell', 'a plain login shell there')}
            ${kind('claude', 'Claude Code', 'the claude CLI, with the field below as its opening prompt')}
            ${kind('command', 'Command', 'runs what you type, and logs it')}
          </div>
          <div class="uk-margin-small-top screen-name-row">
            <label class="uk-form-label" for="screen-session">Session name</label>
            <input class="uk-input uk-form-small" name="session" id="screen-session"
                   value="${esc(p.session || prefilled)}"
                   data-derived="${esc(prefilled)}" data-tail="${esc(prefilled.slice(-4))}"
                   pattern="[a-z0-9][a-zA-Z0-9_.\-]*" title="lowercase start; letters, digits, - _ . after">
            <span class="uk-text-meta">Where it runs, and a short id so a second session here is not the
              same name. <code>screen -r</code> takes it; leave it empty and it is filled in for you.</span>
          </div>
        </fieldset>

        <fieldset class="screen-step" data-claude-only${isClaude ? '' : ' hidden'}>
          <legend>Claude Code</legend>
          ${p.work ? `
          <input type="hidden" name="work_key" value="${esc(p.work)}">
          <label class="claude-arg claude-arg-flag jira-comment-opt" title="Posts one comment on ${esc(p.work)}">
            <input class="uk-checkbox" type="checkbox" name="comment_session" value="1">
            <span>Comment on <strong>${esc(p.work)}</strong> that this session is running</span>
            <span class="claude-arg-help">Posts the session name, a link to its terminal on this hub, and
              how to resume the conversation on this machine — never the transcript or anything the agent
              says. A Claude Code CLI session has no page on claude.ai; it lives on this machine.</span>
          </label>` : ''}
          <!-- Resume rather than start over. A screen session that died — a reboot, a closed terminal,
               a wipe of the dead ones — did not take the conversation with it: the CLI keeps every
               session's transcript, and claude --resume <id> from the same directory picks it back up.
               By id, not --continue, which takes the most recent session for the directory and may not
               be the one meant. It is per DIRECTORY, so a workspace folder has its own sessions exactly
               as a project does, and the list reloads whenever the place above changes.
               No backticks in this comment: the form is a template literal. -->
          <div id="claude-resume-row">${claudeResumeHtml(p.target)}</div>
          ${await claudeArgsHtml(p)}
          <div class="uk-margin-small-top">
            <label class="uk-form-label" for="screen-template">Prompt template</label>
            <select class="uk-select uk-form-small" id="screen-template"
                    title="Fill the prompt below with one of the prompts in the ai-prompts workspace, and set the flags that prompt documents"
                    onchange="window.screenPromptTemplate && window.screenPromptTemplate(this)">
              <option value="">— write it yourself —</option>
              ${promptTemplates().map((f) => `<option value="${esc(f)}" data-flags="${esc(promptTemplateFlags(f))}">${esc(f.replace(/\.md$/, ''))}</option>`).join('')}
            </select>
          </div>
        </fieldset>

        <fieldset class="screen-step">
          <legend><span data-claude-only${isClaude ? '' : ' hidden'}>The prompt it opens with</span><span data-not-claude${isClaude ? ' hidden' : ''}>The command it runs</span></legend>
          <textarea class="uk-textarea uk-form-small" name="command" rows="12" data-ace="sh"
                    data-mentions="/fragments/ai-suggest${p.target && p.target.startsWith('p:') ? `/${esc(p.target.split(':')[1])}/${esc(p.target.split(':').slice(2).join(':'))}` : ''}"
                    placeholder="a command to run, or the prompt Claude Code opens with — leave it empty for a plain session">${esc(p.command || '')}</textarea>
        </fieldset>

        <p class="modal-actions"><button class="uk-button uk-button-primary" type="submit">Start it</button></p>
      </form>
    </div>`;
}

// The page: the New-screen form, a toolbar, then one row per live session —
// a terminal glyph, what it is, and the real screen(1) verbs behind icons.
const TERM_SVG = `
  <svg class="term-glyph" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="94" height="70" rx="8" fill="#300a24" stroke="#5e2750" stroke-width="1.5"/>
    <path d="M1 9a8 8 0 0 1 8-8h78a8 8 0 0 1 8 8v8H1z" fill="#2c001e"/>
    <circle cx="70" cy="9" r="3.1" fill="#77216f"/><circle cx="79" cy="9" r="3.1" fill="#77216f"/><circle cx="88" cy="9" r="3.4" fill="#e95420"/>
    <rect x="8" y="6" width="22" height="6" rx="3" fill="#aea79f" opacity=".55"/>
    <rect x="8" y="26" width="30" height="5" rx="2.5" fill="#8ae234"/><rect x="40" y="26" width="3" height="5" rx="1.5" fill="#ffffff"/>
    <rect x="45" y="26" width="8" height="5" rx="2.5" fill="#729fcf"/><rect x="55" y="26" width="3" height="5" rx="1.5" fill="#ffffff"/>
    <rect x="62" y="24" width="8" height="9" rx="1" fill="#ffffff" class="term-glyph-cursor"/>
    <rect x="8" y="40" width="52" height="4" rx="2" fill="#d3d7cf" opacity=".6"/>
    <rect x="8" y="49" width="38" height="4" rx="2" fill="#d3d7cf" opacity=".4"/>
    <rect x="8" y="58" width="24" height="4" rx="2" fill="#d3d7cf" opacity=".25"/>
  </svg>`;

/** The styles a terminal can wear, in the order the window's menu lists them. terminal.js owns the palettes. */
const TERM_STYLES = [
  ['ubuntu', 'Ubuntu'],
  ['tango', 'Tango light'],
  ['solarized', 'Solarized dark'],
  ['dracula', 'Dracula'],
  ['dashboard', 'Dashboard style'],
];

/** What one `ps` line says about an automation browser. Split out from the
 *  listing so it can be tested against real command lines rather than only
 *  against whatever happens to be running. */
function parseBrowserLine(line) {
  const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
  if (!m) return null;
  const args = m[3];
  // The program itself has to BE a browser. Matching the arguments alone listed
  // `ddev exec … BROWSER=chromium`, its docker-compose and the bash that runs
  // the suite as three separate "browsers".
  const prog = args.split(/\s+/)[0] || '';
  const exe = prog.split('/').filter(Boolean).pop() || '';
  // A browser in ANOTHER container is listed with its path only: this process
  // cannot read that one's cmdline, and `ps` then prints the executable, often
  // cut at a directory (…/chromium_headless_shell). So the whole path counts as
  // evidence, not just the last segment.
  const isBrowser = /^(google-)?chrome(-headless-shell)?$|^chromium(-browser)?$|^headless_shell$|^firefox$|^msedge$|webkit/i.test(exe)
    || /ms-playwright|headless[-_]shell/i.test(prog);
  if (!isBrowser) return null;
  if (/ --type=/.test(args)) return null;                       // a renderer, not the browser
  if (!/remote-debugging-(port|pipe)|ms-playwright|mcp-chrome|playwright/i.test(args)) return null;
  const dir = (args.match(/--user-data-dir=(\S+)/) || [])[1] || '';
  return {
    pid: m[1],
    uptime: m[2],
    profile: (dir.split('/').filter(Boolean).pop() || (/headless[-_]shell/i.test(prog) ? 'test browser' : 'playwright')).slice(0, 40),
    // A headless shell has no window whatever its flags say, so the binary
    // counts as much as --headless does.
    headless: /--headless/.test(args) || /headless[-_]shell/i.test(prog),
    port: (args.match(/--remote-debugging-port=(\d+)/) || [])[1] || '',
    pipe: /--remote-debugging-pipe/.test(args),
  };
}

/** Is this process inside a container? The dashboard shares the machine's pid
 *  namespace, so a suite's browser in a project's web container shows up in
 *  `ps` here exactly like one on the desktop — and it is not on the desktop. */
function processInContainer(pid) {
  try {
    const cgroup = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8');
    return /docker|containerd|kubepods|libpod/.test(cgroup);
  } catch (_) { return false; }
}

/** The Playwright MCP browsers running on this machine, as tiles of their own. */
async function listPlaywrightBrowsers() {
  // An automation browser, not any browser: one driven over a debugging pipe or
  // port, or running from a playwright/mcp profile. The docs tooling's
  // screenshot chromium is short-lived and matches none of those.
  const out = await run('bash', ['-c',
    "ps -eo pid,etime,args | grep -iE 'chrome|chromium|firefox|webkit' | grep -v grep | grep -v ' --type=' "
    + "| grep -E 'remote-debugging-(port|pipe)|ms-playwright|mcp-chrome|playwright' | head -10"],
  process.env.HOME, { timeoutMs: 10 * 1000 });
  const rows = String(out.stdout || '').split('\n').map(parseBrowserLine).filter(Boolean)
    .map((b) => ({ ...b, inContainer: processInContainer(b.pid) }));
  // One browser is several processes, and the helpers of a browser in another
  // container cannot be told apart from it (their arguments are unreadable, so
  // the usual `--type=` filter never sees them). Group them into the one thing
  // they are, oldest first — that is the browser itself.
  const groups = new Map();
  for (const b of rows) {
    const key = `${b.profile}|${b.headless}|${b.inContainer}`;
    const seen = groups.get(key);
    if (!seen) groups.set(key, { ...b, count: 1 });
    else { seen.count += 1; if (b.uptime > seen.uptime) Object.assign(seen, b, { count: seen.count }); }
  }
  return [...groups.values()];
}

async function screensGridHtml() {
  const sessions = await listScreens();
  const toolbar = `
    <div class="uk-flex uk-flex-between uk-flex-middle uk-margin-small screens-toolbar">
      <span class="uk-text-meta">${sessions.length} session${sessions.length === 1 ? '' : 's'}</span>
      <div>
        <!-- One under another by default: a session row carries its name, its state, its log path and
             five verbs, and two of those side by side on a 1400px screen leaves each one narrower than
             the buttons it holds. Two and three across are for a machine with a dozen sessions on it,
             where the question is "which of these is waiting" rather than "what does this one say". -->
        <span class="screens-cols" role="group" aria-label="How many sessions across">
          ${[['1', 'list', 'One under another'], ['2', 'grid', 'Two across'], ['3', 'grid', 'Three across']]
    .map(([n, icon, title]) => `<button type="button" class="uk-button uk-button-default uk-button-small"
            data-screens-cols="${n}" title="${esc(title)}" aria-label="${esc(title)}"
            aria-pressed="false">${n === '1' ? '<span uk-icon="icon: list; ratio: .7"></span>' : `<span uk-icon="icon: ${icon}; ratio: .7"></span> ${n}`}</button>`).join('')}
        </span>
        ${newScreenButtonHtml()}
        <button class="uk-button uk-button-default uk-button-small"
          hx-get="/fragments/screens-grid" hx-target="#webship-workspace-projects" hx-swap="innerHTML"
          title="Refresh the list (screen -ls)"><span uk-icon="icon: refresh; ratio: .8"></span></button>
        <button class="uk-button uk-button-default uk-button-small"
          hx-post="/actions/screen-wipe" hx-target="#webship-workspace-projects" hx-swap="innerHTML"
          title="Remove dead sessions (screen -wipe)"><span uk-icon="icon: trash; ratio: .8"></span> Remove ended sessions</button>
      </div>
    </div>`;
  const claudeHere = agentSessions(sessions);
  const rows = sessions.map((s) => {
    const log = screenLogFor(s.session);
    const dead = /dead/i.test(s.state);
    const attached = /attached/i.test(s.state);
    const verb = (icon, title, attrs) => `
      <button class="uk-button uk-button-default uk-button-small" title="${esc(title)}" ${attrs}>
        <span uk-icon="icon: ${icon}; ratio: .8"></span></button>`;
    return `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small screen-tile${dead ? ' is-dead' : ''}${sessionWaitingWhy(s) ? ' is-waiting' : ''}">
      <div class="uk-flex uk-flex-middle" style="gap:16px">
        ${TERM_SVG}
        <div class="uk-flex-1">
          <div><strong>${esc(s.session)}</strong>
            <span class="uk-label ${dead ? 'uk-label-danger' : attached ? 'screen-state-attached' : 'uk-label-success'}">${esc((s.state || 'detached').toLowerCase())}</span>
            ${(() => {
              // The one rule, in sessionWaitingWhy — the runner's reading of the visible screen
              // first, the log only as the fallback for sessions that write one.
              const why = sessionWaitingWhy(s);
              if (!why) return '';
              // "waiting on yes/no" after "Waiting for you" says waiting twice: keep what it is waiting for.
              const ask = String(why).replace(/^waiting (on|for) /, '');
              return `<span class="uk-label uk-label-warning needs-input" title="Read from its screen just now — open the terminal and answer it">✋ Waiting for you · ${esc(ask)}</span>`;
            })()}
            <span class="uk-text-meta">pid ${esc(s.pid || '?')} · since ${esc(s.started)}</span></div>
          <div class="uk-text-meta">${log ? `log: <code>${esc(tildePath(log))}</code>` : 'no known log — the terminal still works'}
            · on this machine — <code>screen -r ${esc(s.session)}</code> in your own terminal</div>
          <div class="uk-margin-small-top uk-button-group-spaced">
            <button class="uk-button uk-button-primary uk-button-small" type="button"
              data-open-terminal="${esc(s.session)}"
              title="Attach an interactive terminal (screen -x)"><span uk-icon="icon: laptop; ratio: .8"></span> Open terminal</button>
            ${log ? verb('play-circle', 'Follow the log (tail -F)',
              `hx-post="/actions/screen-watch" hx-target="#editor-modal-body" hx-swap="innerHTML"
               hx-vals='{"session":"${esc(s.session)}"}' hx-on::after:request="UIkit.modal('#editor-modal').show()"`) : ''}
            ${verb('sign-out', 'Detach every other client (screen -X detach)',
              `hx-post="/actions/screen-detach" hx-target="#webship-workspace-output" hx-swap="innerHTML"
               hx-vals='{"session":"${esc(s.session)}"}'`)}
            ${verb('bolt', 'Interrupt what runs inside it (Ctrl-C)',
              `hx-post="/actions/screen-interrupt" hx-target="#webship-workspace-output" hx-swap="innerHTML"
               hx-vals='{"session":"${esc(s.session)}"}'
               hx-confirm="Send Ctrl-C to ${esc(s.session)}? Whatever runs inside it is interrupted."`)}
            ${claudeHere.has(s.session) && !dead ? `<button class="uk-button uk-button-default uk-button-small arm-step" type="button"
              title="Exit Claude Code in ${esc(s.session)} (/exit)" hx-trigger="confirmed-remove"
              hx-post="/actions/claude-exit" hx-target="#webship-workspace-output" hx-swap="innerHTML"
              hx-vals='${JSON.stringify({ session: s.session, confirm: 'yes' })}'><span uk-icon="icon: sign-out; ratio: .8"></span> /exit</button>` : ''}
            ${verb('ban', 'Kill the session (screen -X quit)',
              `hx-post="/actions/screen-stop" hx-target="#webship-workspace-projects" hx-swap="innerHTML"
               hx-vals='{"session":"${esc(s.session)}","confirm":"yes"}'
               hx-confirm="Kill the screen session ${esc(s.session)}? Whatever runs inside it is killed."`)}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  // The browsers, listed the same way: what is open, how long, and how to see it.
  const browsers = await listPlaywrightBrowsers();
  const browserRows = !browsers.length ? '' : `
    <h2 class="uk-h4 uk-margin-medium-top uk-margin-small-bottom" id="screens-browsers-title">Playwright browsers</h2>
    <div class="screens-list" data-cols="1" role="group" aria-labelledby="screens-browsers-title">
    ${browsers.map((b) => `
    <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small screen-tile">
      <div class="uk-flex uk-flex-middle" style="gap:16px">
        <span uk-icon="icon: world; ratio: 1.6"></span>
        <div class="uk-flex-1">
          <div><strong>${esc(b.profile)}</strong>
            <span class="uk-label uk-label-${b.headless || b.inContainer ? 'warning' : 'success'}">${b.headless ? 'headless' : b.inContainer ? 'in a container' : 'on your desktop'}</span>
            <span class="uk-text-meta">pid ${esc(b.pid)} · up ${esc(b.uptime)}${b.count > 1 ? ` · ${b.count} processes` : ''}</span></div>
          <div class="uk-text-meta">${b.port
            ? `DevTools on <a href="http://127.0.0.1:${esc(b.port)}" target="_blank">127.0.0.1:${esc(b.port)}</a>`
            : 'Driven over a pipe, so it has no DevTools url'}${b.headless
              ? ' · no window at all; it writes its screenshots to a file'
              : b.inContainer
                ? ' · it runs inside a container, so its window is not on the desktop'
                : ' · its window is already open on this machine'}</div>
        </div>
      </div>
    </div>`).join('')}
    </div>`;
  return toolbar
    + (sessions.length
      ? `<div class="screens-list" data-cols="1">${rows}</div>`
      : '<div class="msg assistant">No screen sessions right now — start one above, or anything from cmd-tools-screen.sh and Jira "Work on it" appears here.</div>')
    + browserRows;
}

async function screensListHtml() {
  const sessions = await listScreens();
  const rows = sessions.map((s) => {
    const log = screenLogFor(s.session);
    return `
      <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small">
        <div>📺 <strong>${esc(s.session)}</strong> <span class="uk-label uk-label-success">running</span>
          <span class="uk-text-meta">since ${esc(s.started)}</span></div>
        <div class="uk-margin-small-top">
          ${log ? `<button class="uk-button uk-button-primary uk-button-small"
            hx-post="/actions/screen-watch" hx-target="#editor-modal-body" hx-swap="innerHTML"
            hx-vals='{"session":"${esc(s.session)}"}'><span uk-icon="icon: play-circle; ratio: .6"></span> Watch live</button>` : ''}
          <button class="uk-button uk-button-danger uk-button-small"
            hx-post="/actions/screen-stop" hx-target="#webship-workspace-output" hx-swap="innerHTML"
            hx-vals='{"session":"${esc(s.session)}","confirm":"yes"}'
            hx-confirm="Stop the screen session ${esc(s.session)}? Whatever runs inside it is killed."><span uk-icon="icon: close; ratio: .6"></span> Stop</button>
          <span class="uk-text-meta">· reattach in a terminal: <code>ddev ssh</code> then <code>screen -r ${esc(s.session)}</code> (Ctrl-A D detaches, it keeps running)</span>
        </div>
      </div>`;
  }).join('');
  return sessions.length ? rows : '<div class="msg assistant">No screen sessions right now.</div>';
}


/* ------------------------------------------------------------------ *
 * The terminal panes, and the dock that holds them
 * ------------------------------------------------------------------ */

/**
 * The commands that reach THIS session in a real terminal.
 *
 * The session runs on the machine, so these are the plain ones — and the follow command needs the real
 * workspace rather than a placeholder nobody can paste.
 */
function termCliHintHtml(session) {
  let ws = '';
  try {
    const dir = fs.readFileSync(path.join(ROOT, '.screens', `${session}.cwd`), 'utf8').trim();
    const rel = path.relative(ROOT, dir);
    if (rel && !rel.startsWith('..')) ws = rel.split(path.sep)[0];
  } catch (_) { /* an unknown owner falls back below */ }
  if (!ws) ws = (session.match(/^([a-z0-9_-]+)--/) || [])[1] || '';
  const followDir = ws ? path.join(ROOT, ws) : ROOT;
  return `<details class="uk-margin-small-bottom term-cli-hint">
    <summary class="uk-text-meta">Same session in a real terminal</summary>
    <div class="uk-text-meta">
      <div><code>screen -r ${esc(session)}</code> <span>— attach it (<code>Ctrl-A D</code> detaches again, it keeps running)</span></div>
      <div><code>screen -x ${esc(session)}</code> <span>— share it: the browser and the terminal see the same screen</span></div>
      ${ws ? `<div><code>cd ${esc(tildePath(followDir))} &amp;&amp; bash cmd-tools-screen.sh ${esc(session)} --follow</code> <span>— follow its log instead</span></div>` : ''}
      ${(() => {
        // The Claude Code session this folder is having, by id.
        //
        // It is LOCAL, and there is deliberately no link on it. A CLI session is a transcript in
        // ~/.claude/projects on this machine: it has no page on claude.ai, and the claude.ai/code
        // session ids that turn up in transcripts belong to cloud sessions, not to these. A link
        // would either go nowhere or suggest the conversation is on the web when it is not — and
        // these are client projects, so the id is something to resume with, never to publish.
        //
        // The NEWEST session for the folder, said as that rather than as "this session's": a screen
        // started with `exec claude` does not record which conversation it ended up in, and claiming
        // an id that might belong to another window would be worse than showing none.
        let dir = '';
        try { dir = fs.readFileSync(path.join(ROOT, '.screens', `${session}.cwd`), 'utf8').trim(); } catch (_) { return ''; }
        let latest;
        try { [latest] = require('./claude-sessions').sessionsFor(dir, { limit: 1 }); } catch (_) { return ''; }
        if (!latest) return '';
        return `<div><code class="claude-session-id">claude --resume ${esc(latest.id)}</code> <span>— the newest
          Claude Code session in this folder, reopened here on this machine. A CLI session is a local
          transcript; it has no page on claude.ai.</span></div>`;
      })()}
    </div>
  </details>`;
}

/**
 * One terminal, as a window of its own.
 *
 * It carries the session's OWN verbs — interrupt, detach, kill — and not only the window's. They were
 * on the screen row alone, which meant that acting on the session you were watching started by closing
 * the terminal you were watching it in. Each goes through the dashboard's one confirm dialog, the way
 * the row's do, and the two destructive ones say what they will end.
 *
 * Every id in here is a CLASS instead: several terminals are open at once, and ids made the second one
 * drive the first one's status line and buttons — which is precisely why only one could ever be open.
 *
 * The geometry is not here. Where a window sits and how big it is belongs to the browser that put it
 * there (public/terminal.js, localStorage), so the server renders the same markup whether this is the
 * first terminal or the fifth.
 */
function termPaneHtml(session) {
  const verb = (cls, icon, title, attrs = '', extra = '') => `<button type="button"
      class="uk-button uk-button-default uk-button-small ${cls}" title="${esc(title)}"
      aria-label="${esc(title)}"${attrs ? ` ${attrs}` : ''}>${
  icon ? `<span uk-icon="icon: ${icon}; ratio: .7"></span>` : ''}${extra}</button>`;
  const vals = (extra) => esc(JSON.stringify({ session, ...extra }));
  return `
    <section class="term-window" data-session="${esc(session)}" role="dialog" aria-label="Terminal — ${esc(session)}">
      <header class="term-window-head">
        <span class="term-title" title="${esc(session)}"><span uk-icon="icon: laptop; ratio: .7"></span> ${esc(session)}</span>
        <span class="term-status uk-text-meta">connecting…</span>
        <span class="term-verbs">
          <!-- A button as well as the wheel: scrolling back is screen's copy mode, and nobody should
               have to know that, let alone the chord for it. Pressing q leaves it, which the status
               line says while it is open. No backticks in this comment: the function is one template
               literal, and the repo has a test for exactly this. -->
          ${verb('term-scrollback', 'arrow-up', `Scroll back through what ${session} printed (q leaves it)`)}
          <!-- The size, in columns and rows, which is how a terminal is measured: the same four the
               GNOME/Ubuntu terminal offers. Reset — the menu entry and a double-click on the title bar
               — goes to 132x43, which is also what a window opens at, clamped to the display if it is
               too small to hold it. -->
          <span class="uk-inline term-size-pick">
            ${verb('term-fit', 'cog', 'Size, text size and style of this window')}
            <div uk-dropdown="mode: click; pos: bottom-right" class="term-look-menu"><ul class="uk-nav uk-dropdown-nav">
              <li class="uk-nav-header">Size</li>
              ${[[80, 24], [80, 43], [132, 24], [132, 43]].map(([c, r]) =>
    `<li><a href data-term-size="${c}x${r}">${c} &times; ${r}</a></li>`).join('')}
              <li><a href data-term-size="fit">Reset to 132 &times; 43</a></li>
              <li class="uk-nav-divider"></li>
              <li class="uk-nav-header">Text size</li>
              <li class="term-font-row">
                <button type="button" class="uk-button uk-button-default uk-button-small" data-term-font="down" aria-label="Smaller text" title="Smaller (Ctrl and minus)"><span uk-icon="icon: minus; ratio: .7"></span></button>
                <span class="term-font-size" aria-live="polite">17 px</span>
                <button type="button" class="uk-button uk-button-default uk-button-small" data-term-font="up" aria-label="Larger text" title="Larger (Ctrl and plus)"><span uk-icon="icon: plus; ratio: .7"></span></button>
                <button type="button" class="uk-button uk-button-default uk-button-small" data-term-font="reset" title="Back to the default (Ctrl and 0)">Reset</button>
              </li>
              <li class="uk-nav-divider"></li>
              <li class="uk-nav-header">Style</li>
              ${TERM_STYLES.map(([id, label]) =>
    `<li><a href role="menuitemradio" aria-checked="false" data-term-style="${id}"><span class="term-swatch" aria-hidden="true"></span> ${label}</a></li>`).join('')}
            </ul></div>
          </span>
          ${verb('term-reconnect', 'refresh', 'Reconnect this terminal',
    `hidden hx-get="/fragments/screen-term/${encodeURIComponent(session)}" hx-target="closest .term-window" hx-swap="outerHTML"`)}
          <!-- Ctrl-C goes down THIS window's own socket, not to /actions/screen-interrupt.
               onHostScreen says it plainly — "detach and Ctrl-C are screen's own; the runner does not
               proxy them yet" — so that endpoint answers 500 for a session on the host, which is every
               session here. A window is already attached to the session, and sending the byte is
               exactly what typing it would do. terminal.js does it, after the same confirm. -->
          ${verb('term-interrupt arm-step', 'bolt', `Interrupt what runs in ${session} (Ctrl-C)`)}
          <!-- The wheel writing mouse coordinates into the shell instead of scrolling is a mode a
               program turned on and did not turn off: screen replays the window's state to every
               display that attaches, so it follows the session into a real terminal too. Nothing on
               screen can say so, which is why there is a button for it. It types a printf at the
               prompt (the only way to reach a window's terminal), so it asks first, like the other
               two verbs that do. No backticks in this comment: the function is one template literal,
               and the repo has a test for exactly this. -->
          ${verb('term-reset-modes arm-step', 'crosshairs', `Clear the mouse and paste modes in ${session} — the fix when the wheel writes characters instead of scrolling`,
    `hx-post="/actions/screen-reset-modes" hx-vals='${vals({ confirm: 'yes' })}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"`)}
          ${verb('term-detach arm-step', 'sign-out', `Detach every other client from ${session}`,
    `hx-post="/actions/screen-detach" hx-vals='${vals({})}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"`)}
          ${verb('term-kill arm-step', 'ban', `Kill the session ${session}`,
    `hx-post="/actions/screen-stop" hx-vals='${vals({ confirm: 'yes' })}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"`)}
          <span class="term-verbs-sep" aria-hidden="true"></span>
          ${verb('term-fullscreen', 'expand', 'Fill the screen (Esc to come back)')}
          <a class="uk-button uk-button-default uk-button-small term-newtab" title="Open this session in its own tab"
             aria-label="Open this session in its own tab"
             href="/terminal/${encodeURIComponent(session)}" target="_blank"><span uk-icon="icon: link-external; ratio: .7"></span></a>
          ${verb('term-close', 'close', `Close this terminal (${session} keeps running)`)}
        </span>
      </header>
      <div class="term-screen"></div>
      ${termCliHintHtml(session)}
      <!-- The corner grip. The CSS resize property needs a scroll container and drags the element's own
           box, which fights an absolutely placed window, so the drag is done in terminal.js and this is
           its handle. No backticks in this comment: the function is one template literal. -->
      <span class="term-resize" title="Drag to resize" aria-hidden="true"></span>
    </section>`;
}

/**
 * The layer every terminal window floats in.
 *
 * Empty in the page shell: `public/terminal.js` fills it as terminals are opened, and the bar that
 * counts them and arranges them is drawn there too — it exists only while something is open, and a
 * server-rendered one would be an empty strip on every page of the dashboard.
 */
function termLayerHtml(sessions = []) {
  return `<div id="term-windows">${sessions.map(termPaneHtml).join('')}</div>`;
}

module.exports = {
  TERM_STYLES,
  termPaneHtml, termLayerHtml, termCliHintHtml,
  claudeResumeHtml,
  waitingState, sessionWaitingWhy, agentSessions, activityByDir, activityFromSessions, listScreens, listContainerScreens, listPlaywrightBrowsers, parseBrowserLine, processInContainer, sessionNeedsInput, screensForDir, screenLogFor, screensListHtml, screensGridHtml, screenTailHtml, screenTargets, screenTargetDir, newScreenFormHtml, newScreenButtonHtml, screenWhereHtml, workspaceOptionsHtml, workspaceOfTarget, targetOptionsHtml, defaultSessionName, claudeArgsHtml, promptTemplates, promptTemplateText };
