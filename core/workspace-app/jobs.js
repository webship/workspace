/**
 * Running a command, and the registry of the ones still running.
 *
 * Every long action in the dashboard — a build, an index, a test suite — is a job: spawned
 * detached, streamed into a buffer, and polled by the page as a fragment. The registry is in
 * memory on purpose, which is why restarting the app while a job runs loses the job.
 *
 * Split out of server.js: nothing here knows about routing, and the actions that start jobs can
 * import the runner without importing the server.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { esc } = require('./html');

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, env } = {}) {
  return new Promise((resolve) => {
    // stdin must be closed ('ignore') — ddev wraps commands in `docker exec -i`,
    // which hangs indefinitely on an open-but-silent stdin pipe.
    const child = spawn(cmd, args, { cwd, env: env || jobEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: -1, stdout, stderr: String(err.message) }); });
  });
}

// A project's real DDEV name (from its .ddev/config.yaml), or null if it
// isn't a DDEV project. The name usually equals the folder name (the build
// scripts pass --project-name=<folder>), but not necessarily.
// The DDEV project name for a directory, or null when it is not a DDEV project.
//
// `name:` is OPTIONAL in config.yaml — DDEV omits it when the project name is
// just the directory name, which is the common case for anything created with
// `ddev config` in place. Returning null there treated a real DDEV project as an
// ordinary folder, so it got no status badge and no Start/Stop/Launch at all: on
// this machine that silently hid the controls for 5 of the 13 DDEV projects in
// test/. The presence of .ddev/config.yaml is what makes it a project; `name:` is
// only an override.
function ddevProjectName(projectDir) {
  const cfgPath = path.join(projectDir, '.ddev', 'config.yaml');
  let cfg;
  try {
    cfg = fs.readFileSync(cfgPath, 'utf8');
  } catch (_) {
    return null;
  }
  const m = cfg.match(/^name:\s*["']?([^"'\s]+)/m);
  if (m) return m[1];
  // DDEV's own default: the directory name, with the characters it disallows in a
  // project name replaced the way it does.
  return path.basename(projectDir).replace(/[^a-zA-Z0-9._-]/g, '-');
}

/* Background jobs with live terminal output: long actions run detached while
 * the page polls /fragments/job/<id> every second, streaming the command's
 * real stdout/stderr into a terminal box until it exits. */
const jobs = new Map();
let jobSeq = 0;

// Is a job with this key still running? graphify runs must not overlap.
// The id of the running job under this key, or null. Every existing caller
// treats the answer as a boolean, and an id is truthy — but a caller that wants
// to SHOW the running job (Watch) needs the id itself.
function runningJobKey(key) {
  for (const [id, job] of jobs.entries()) if (job.key === key && !job.done) return id;
  return null;
}

// Nothing started from the dashboard has anyone to answer a prompt: stdin is closed (it has
// to be — `docker exec -i` hangs on an open one), so a question just stalls the job until its
// timeout. DDEV asks one after an upgrade: "May we send anonymous DDEV usage statistics?".
// Applies to the whole subtree, so a cmd-*.sh that calls ddev is covered too.
function jobEnv() {
  return { ...process.env, DDEV_NONINTERACTIVE: 'true' };
}

// Wrap a command so it runs detached in a `screen` session that outlives this
// process, while a job can follow it live: the command's output goes to logFile,
// the returned shell line starts the session, tails the log, waits for the
// session to end, then prints the tail. One place owns this pattern — the exact
// quoting and the waiter were each wrong once (a bare `&` after a && chain
// backgrounds the whole chain; the session-poll must dot-escape the name).
// The screen configuration every session this dashboard starts runs under.
//
// There was none, so each session took screen's defaults: 100 lines of scrollback (one screen of a
// build log), no alt-screen (so a TUI's every repaint lands in the scrollback), and Ctrl-S as flow
// control (which looks exactly like a hung session). It lives beside the app rather than in
// ~/.screenrc, because it belongs to the dashboard's sessions and must not change a machine's own.
const SCREENRC = require('path').join(__dirname, 'screenrc');
const screenCmd = () => `screen -c ${JSON.stringify(SCREENRC)}`;

function screenWrap({ session, inner, logFile }) {
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(session)) throw new Error(`bad screen session name: ${session}`);
  return [
    `: > ${JSON.stringify(logFile)}`,
    `${screenCmd()} -dmS ${session} bash -c ${JSON.stringify(`{ ${inner} ; } 2>&1 | tee -a ${logFile}`)}`,
    `sleep 1`,
    `echo "Running in screen session ${session} — it survives dashboard restarts; reattach with: screen -r ${session}"`,
    `( tail -F ${JSON.stringify(logFile)} 2>/dev/null & echo $! > /tmp/.tp-${session} )`,
    `while screen -ls 2>/dev/null | grep -q "[.]${session}[[:space:]]"; do sleep 3; done`,
    `sleep 1`,
    `kill $(cat /tmp/.tp-${session}) 2>/dev/null; rm -f /tmp/.tp-${session}`,
    `echo`, `echo "--- last lines of the log ---"`,
    `tail -n 8 ${JSON.stringify(logFile)}`,
  ].join('; ');
}

function startJob(title, cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, echoLine = '', key = null, phases = null, inline = false, env = null } = {}) {
  const id = `${++jobSeq}-${Math.random().toString(36).slice(2, 8)}`;
  // `phases` — ordered output markers; the fragment counts which have appeared and renders an
  // honest progress bar. `inline` — the toast stays where it was swapped in (a modal) instead
  // of being adopted into the corner stack.
  const job = { title, key, phases, inline, buf: echoLine ? `$ ${echoLine}\n\n` : '', done: false, ok: null };
  jobs.set(id, job);
  // stdin 'ignore' — see run(): docker exec -i hangs on an open stdin pipe.
  // detached: killing the bash wrapper leaves ddev/composer/graphify children
  // running, so signal the whole process group on timeout.
  const child = spawn(cmd, args, { cwd, env: env ? { ...env, DDEV_NONINTERACTIVE: 'true' } : jobEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  job.child = child;
  const append = (d) => { job.buf = (job.buf + d.toString()).slice(-30000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => {
    append(`\n⏱️ timed out after ${Math.round(timeoutMs / 60000)}m — stopping\n`);
    try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill('SIGTERM'); }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* gone */ } }, 10000);
  }, timeoutMs);
  // Forget the job half an hour after it FINISHES, not half an hour after it starts.
  //
  // Started from the start, the timer fired while the work was still going: a Varbase suite is
  // 275 scenarios and takes about forty minutes, so at minute thirty the toast turned into
  // "Job not found (expired)" and the live output stopped — while the run carried on invisibly,
  // with nothing left in the interface to say whether it passed. Anything long enough to want a
  // progress toast is long enough to outlive a timer started at launch.
  const forget = () => setTimeout(() => jobs.delete(id), 30 * 60 * 1000);
  child.on('close', (code) => { clearTimeout(timer); job.done = true; job.ok = code === 0; forget(); });
  child.on('error', (err) => { clearTimeout(timer); job.buf += `\n${err.message}`; job.done = true; job.ok = false; forget(); });
  return id;
}

// Stop a running job for real: the whole process group, then the toast says so.
function stopJob(id) {
  const job = jobs.get(id);
  if (!job || job.done || !job.child) return false;
  job.buf += '\n🛑 stopped by the user\n';
  job.stopped = true;
  try { process.kill(-job.child.pid, 'SIGTERM'); } catch (_) { try { job.child.kill('SIGTERM'); } catch (_2) { /* gone */ } }
  setTimeout(() => { try { process.kill(-job.child.pid, 'SIGKILL'); } catch (_) { /* gone */ } }, 5000);
  return true;
}

function jobFragment(id) {
  const job = jobs.get(id);
  if (!job) return { html: '<div class="msg error">Job not found (expired).</div>', done: true };
  const text = job.buf.replace(/\x1b\[[0-9;]*[mK]/g, '');
  const status = job.done ? (job.stopped ? '🛑 stopped' : job.ok ? '✅ finished' : '❌ failed') : '<span uk-spinner="ratio: .5"></span> running…';
  const poll = job.done ? '' : ` hx-get="/fragments/job/${id}" hx-trigger="every 1s" hx-swap="outerHTML"`;
  // A job is a toast: it outlives the page area it was launched from, so a build survives
  // navigating elsewhere, and it can be collapsed while it runs. The element polls ITSELF and
  // replaces itself, which is what lets ui.js move it into the toast stack once and leave it
  // there — every later poll lands wherever the element currently is.
  const state = job.done ? (job.ok ? 'is-done' : 'is-failed') : 'is-running';
  // The honest progress bar: phases are output markers, so the bar can only say what the
  // output already proves — k of n phases reached, and the name of the current one.
  let progress = '';
  if (Array.isArray(job.phases) && job.phases.length) {
    let reached = 0;
    for (const marker of job.phases) { if (text.includes(marker)) reached += 1; }
    const total = job.phases.length;
    const value = job.done && job.ok ? total : reached;
    const current = job.done ? (job.ok ? 'Done' : 'Failed') : (job.phases[Math.min(reached, total - 1)] || '');
    progress = `
      <div class="job-progress">
        <progress class="uk-progress" value="${value}" max="${total}"></progress>
        <span class="uk-text-meta">${esc(current)} (${value}/${total})</span>
      </div>`;
  }
  const html = `
    <div class="msg ${job.done && !job.ok ? 'error' : 'assistant'} terminal job-toast ${state}${job.inline ? ' job-inline' : ''}" id="job-${id}"${poll}>
      <div class="job-toast-head">
        <span class="job-toast-title">${job.title}</span>
        <span class="job-toast-status">${status}</span>
        ${job.done ? '' : `<button type="button" class="job-toast-btn" title="Stop this job — the process is killed"
                hx-post="/actions/job-stop" hx-vals='{"id":"${id}"}' hx-target="#job-${id}" hx-swap="outerHTML"
                hx-confirm="Stop this job? The running process is killed."><span uk-icon="icon: ban; ratio: .7"></span></button>`}
        ${job.inline ? '' : `<button type="button" class="job-toast-btn job-toast-collapse" title="Collapse or expand this job"
                aria-expanded="true"><span uk-icon="icon: chevron-up; ratio: .7"></span></button>
        <button type="button" class="job-toast-btn job-toast-close" title="Dismiss${job.done ? '' : ' (the job keeps running)'}"
                aria-label="Dismiss"><span uk-icon="icon: close; ratio: .7"></span></button>`}
      </div>
      ${progress}
      <pre class="terminal-pre">${esc(text) || '…'}</pre>
      ${job.inline && job.done ? `<p class="job-done-note">${job.ok ? '✅ Done — the process finished. You can close this window.' : '❌ The process failed — the output above says where.'}</p>` : ''}
    </div>`;
  return { html, done: job.done };
}

function listProjects(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
}

// The same list with a modification time, so the sorts that file lists already offer work
// here too. The project directory's own mtime is what changes when it is rebuilt.
function listProjectsDetailed(dir) {
  return listProjects(dir).map((name) => {
    let mtime = new Date(0);
    try { mtime = fs.statSync(path.join(dir, name)).mtime; } catch (_) { /* vanished mid-read */ }
    return { name, mtime };
  });
}


// Every project command runs the same way: detached in a screen session named
// after the project, logged where the Screens page can find it, and answered
// with a pointer rather than a toast that follows the user around. The session
// name always carries the folder, so `screen -ls` and the row's SCREENS group
// both read as "what is happening to THIS project".

// ------------------------------------------------------- the host runner --
// Sessions belong on the machine, not in this container: that is where the
// display, the browser an agent drives and the user's own ~/.claude live. The
// runner on the host does the starting and attaching; this is how the dashboard
// asks it. When it is not running, everything falls back to the container, so
// the dashboard keeps working either way.
function hostRunner() {
  const { ROOT } = require('./workspaces');
  try {
    const store = path.join(ROOT, '.screens');
    const token = fs.readFileSync(path.join(store, '.runner-token'), 'utf8').trim();
    const port = Number(fs.readFileSync(path.join(store, '.runner-port'), 'utf8').trim());
    if (!token || !port) return null;
    return { token, port, base: `http://host.docker.internal:${port}` };
  } catch (_) { return null; }
}

async function hostRunnerCall(pathname, { method = 'GET', body = null } = {}) {
  const r = hostRunner();
  if (!r) return null;
  try {
    const res = await fetch(`${r.base}${pathname}`, {
      method,
      headers: { 'X-Runner-Token': r.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (_) {
    return null;   // not reachable: the caller falls back to the container
  }
}

/** Is the host runner alive? Its published file says so by being fresh: it is
 *  rewritten every two seconds, so anything older than fifteen means nobody is
 *  home. This is a file read, not a socket — the container cannot always reach
 *  the host over the network, but it always shares this folder. */
function hostSessionsFile() {
  const { ROOT } = require('./workspaces');
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.screens', 'host-sessions.json'), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.at !== 'number') return null;
    return (Date.now() - data.at) < 15000 ? data : null;
  } catch (_) { return null; }
}

async function hostRunnerUp() {
  return !!hostSessionsFile();
}

/** Ask the runner to do something, through the folder both sides can see. */
async function hostRunnerRequest(action, payload, { timeoutMs = 30000 } = {}) {
  const { ROOT } = require('./workspaces');
  const store = path.join(ROOT, '.screens');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.mkdirSync(path.join(store, 'queue'), { recursive: true });
    fs.mkdirSync(path.join(store, 'results'), { recursive: true });
    // Written beside, then renamed: the runner must never read half a request.
    const tmp = path.join(store, 'queue', `.${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ id, action, ...payload }));
    fs.renameSync(tmp, path.join(store, 'queue', `${id}.json`));
  } catch (_) { return null; }
  const resultFile = path.join(store, 'results', `${id}.json`);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const body = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      fs.unlink(resultFile, () => {});
      return body;
    } catch (_) { /* not answered yet */ }
    await new Promise((r) => { setTimeout(r, 150); });
  }
  return null;
}

// A session name is workspace--project--verb, at most 60 characters. It used to be cut at 60, so on a long
// project name different commands became the same session — `composer update` and `composer update --dry-run`,
// two actions whose ids start alike — and one was refused as "still running", or replaced the other's output.
// A name that fits is exactly what it always was. One that does not keeps the workspace in front and the verb
// whole at the end (the screens page reads a Jira key from the end of a name), and shortens the project,
// adding a hash of the full name so it stays unique.
function screenSessionName(project, verb, workspace) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').replace(/^-+|-+$/g, '');
  const name = clean([workspace, project, verb].filter(Boolean).join('--'));
  if (name.length <= 60) return name;
  const hash = require('crypto').createHash('sha1').update(name).digest('hex').slice(0, 6);
  const ws = clean(workspace);
  const vb = clean(verb);
  const room = 60 - (ws ? ws.length + 2 : 0) - (vb ? vb.length + 2 : 0) - 7;
  if (room >= 4) {
    const pr = clean(project).slice(0, room).replace(/[-.]+$/, '');
    return [ws, `${pr}-${hash}`, vb].filter(Boolean).join('--');
  }
  // A verb too long to keep whole: the front of the name, and the hash.
  return `${name.slice(0, 53).replace(/[-.]+$/, '')}-${hash}`;
}

async function startInScreen({ project, projectDir, ownerDir, verb, cmdLine, label, workspace }) {
  const { ROOT } = require('./workspaces');
  const session = screenSessionName(project, verb, workspace);
  const logDir = path.join(ROOT, '.screens');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) { /* exists */ }
  const logFile = path.join(logDir, `${session}.log`);
  // The row's SCREENS group reads this to know which sessions are its own. It
  // is the PROJECT the work belongs to, which is not always where the command
  // runs: a workspace script like cmd-tools-backup.sh runs from the workspace
  // folder and takes the project as an argument.
  try { fs.writeFileSync(path.join(logDir, `${session}.cwd`), `${ownerDir || projectDir}\n`); } catch (_) { /* best effort */ }

  // Sessions belong on the machine: that is where the display, the browser an
  // agent drives, and the user's own terminal are — `screen -r <name>` should
  // just work, without `ddev ssh` first.
  if (!(await hostRunnerUp())) {
    return { ok: false, session, needsRunner: true };
  }
  const answer = await hostRunnerRequest('start',
    { session, dir: projectDir, owner: ownerDir || projectDir, cmd: cmdLine });
  if (!answer) return { ok: false, session, needsRunner: true };
  if (answer.already) return { ok: false, session, already: true, where: 'host' };
  if (answer.ok) return { ok: true, session, label, where: 'host' };
  return { ok: false, session, why: answer.error || 'the host runner refused it', where: 'host' };
}

// Everything below stays for the sessions that already exist in the container:
// they are listed and attachable until they end, but nothing new joins them.
async function startInContainerScreen({ project, projectDir, ownerDir, verb, cmdLine, label, workspace }) {
  const { ROOT } = require('./workspaces');
  const session = screenSessionName(project, verb, workspace);
  const logDir = path.join(ROOT, '.screens');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) { /* exists */ }
  const logFile = path.join(logDir, `${session}.log`);
  try { fs.writeFileSync(path.join(logDir, `${session}.cwd`), `${ownerDir || projectDir}\n`); } catch (_) { /* best effort */ }
  const live = await run('screen', ['-ls'], process.env.HOME, { timeoutMs: 10 * 1000 });
  if (new RegExp(`\\.${session}\\s`).test(String(live.stdout || ''))) {
    return { ok: false, session, already: true };
  }
  // Braces group the whole line before the pipe, so every part is logged.
  const inner = `{ ${cmdLine} ; } 2>&1 | tee -a ${JSON.stringify(logFile)}`;
  const out = await run('bash', ['-c',
    `: > ${JSON.stringify(logFile)} && ${screenCmd()} -dmS ${session} bash -lc ${JSON.stringify(inner)}`],
  projectDir, { timeoutMs: 30 * 1000 });
  if (!out.ok) return { ok: false, session, why: String(out.stderr || out.stdout).slice(-200) };
  return { ok: true, session, logFile, label };
}

/** The one shape every action uses: start the command in a screen session on
 *  the machine and answer with where to watch it. Nothing the dashboard runs
 *  is a toast any more — it is a session on the Screens page. */
async function screenAction(send, opts) {
  const started = await startInScreen(opts);
  return send(screenStartedHtml(started, opts.label, opts.project || opts.workspace),
    started.ok ? 200 : (started.already ? 409 : 500));
}

/** The standard answer: what started, where to watch it.
 *
 *  `flash-now` marks these as a RESULT rather than content. It matters because 37 of the
 *  buttons that start a session post into #editor-modal-body — Remove, Clone, Restore and
 *  the item forms all open a modal, and the response replaces that form. ui.js otherwise
 *  leaves anything inside the modal alone, which is right for an editor and wrong here:
 *  the modal stayed open holding a sentence about a session that had already started. */
function screenStartedHtml(result, label, project) {
  const { esc } = require('./html');
  if (result.needsRunner) {
    return `<div class="msg error flash-now">Sessions run on your machine, not in the dashboard's container — and its runner is not up, so <code>${esc(label)}</code> was not started.
      <br>Start it once with:
      <br><code>bash ${esc(require('./format').tildePath(require('./workspaces').ROOT))}/core/workspace-app/scripts/screen-host.sh --start</code>
      <br><span class="uk-text-meta">It needs <code>screen</code> on this machine (<code>bash core/scripts/install.sh</code> installs it). After that <code>screen -r &lt;session&gt;</code> works straight from your own terminal.</span></div>`;
  }
  if (result.already) {
    return `<div class="msg error flash-now"><code>${esc(label)}</code> is already running on <strong>${esc(project)}</strong> — session <code>${esc(result.session)}</code>, on <a href="/screens">Screens</a>.</div>`;
  }
  if (!result.ok) {
    return `<div class="msg error flash-now">Could not start <code>${esc(label)}</code>: ${esc(result.why || 'unknown error')}</div>`;
  }
  // A toast is read in a glance, so it says what started, where, and where to look —
  // and stops. The session id is what `screen -r` needs, and the Screens page prints
  // it beside a live terminal; repeating it here is what turned one sentence into a
  // paragraph, and a paragraph into something that reads as an error.
  // `data-reload-on-close` is why the row for a project you just built appears without
  // anyone pressing anything: the session is detached, so the page that started it has
  // no idea the list changed. Only on the success path — an error toast reloading the
  // page would take the message away before it could be acted on.
  return `<div class="msg assistant flash-now" data-reload-on-close="1"><code>${esc(label)}</code> on <strong>${esc(project)}</strong> — <a href="/screens">watch on Screens</a></div>`;
}

module.exports = {
  SCREENRC, screenCmd,
  screenWrap,
  run, jobs, runningJobKey, startJob, stopJob, jobFragment,
  startInScreen, startInContainerScreen, screenStartedHtml, screenSessionName, screenAction,
  hostRunner, hostRunnerCall, hostRunnerUp, hostRunnerRequest, hostSessionsFile,
  // Not job machinery, but they travelled inside the same span of server.js and every
  // caller of them also calls the runner. They move properly in the next split.
  ddevProjectName, listProjects, listProjectsDetailed,
};
