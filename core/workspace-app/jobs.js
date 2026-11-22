/**
 * Running a command: in a screen session, always (startInScreen: a plugin's runner, the host
 * runner, or screen where the dashboard runs). Nothing the dashboard starts is drawn as a
 * terminal in the page.
 *
 * A job is the smaller thing left beside it: a process followed where it was asked for (the log
 * of a session in a modal, a plugin's progress view), streamed into a buffer and polled as a
 * fragment. Its registry is in memory on purpose, so restarting the app loses it — and loses no
 * command, since those are sessions.
 *
 * Split out of server.js: nothing here knows about routing, and the actions that start jobs can
 * import the runner without importing the server.
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { spawn } = require('child_process');

// Set while a plugin's runner is deciding how to run a command (pluginRun). A runner runs it in a screen
// session or declines; it may not start it as a job in the page (#409): a plugin from before 1.0.13 still
// offers that (screens 1.0.9 and older with runs.default_mode: page), and a workspace that updates the base
// before its plugins would otherwise run commands there again.
const insideRunner = new AsyncLocalStorage();

const { esc } = require('./html.mts');

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, env } = {}) {
  return new Promise((resolve) => {
    // stdin must be closed ('ignore') — ddev wraps commands in `docker exec -i`,
    // which hangs indefinitely on an open-but-silent stdin pipe.
    // spawn throws, rather than emitting 'error', on an argument it cannot pass (a NUL in it): answered
    // like a command that could not start, never a promise that rejects in a route nobody awaits.
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: env || jobEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(err && err.message || err) });
      return;
    }
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

/* Jobs: a process whose output is followed where it was asked for (a modal, a panel), polled at
 * /fragments/job/<id> every second until it exits. Never a stack at the bottom of the page. */
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

// A job is drawn where it was asked for (a modal, a panel) and stays there: there is no stack at the
// bottom of the page for it to join. Commands do not start here — they start in a screen session
// (startInScreen). What is left is a view that follows something: the log of a session, a
// plugin's own progress.
function startJob(title, cmd, args, cwd, { timeoutMs = 15 * 60 * 1000, echoLine = '', key = null, phases = null, env = null } = {}) {
  if (insideRunner.getStore()) throw new Error('a command runs in a screen session: a runner may not start it as a job in the page');
  const id = `${++jobSeq}-${Math.random().toString(36).slice(2, 8)}`;
  // `phases` — ordered output markers; the fragment counts which have appeared and renders an
  // honest progress bar.
  const job = { title, key, phases, buf: echoLine ? `$ ${echoLine}\n\n` : '', done: false, ok: null };
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
  // Started from the start, the timer fired while the work was still going: a Webship suite is
  // 275 scenarios and takes about forty minutes, so at minute thirty the view turned into
  // "Job not found (expired)" and the live output stopped — while the run carried on invisibly,
  // with nothing left in the interface to say whether it passed. Anything long enough to want a
  // progress view is long enough to outlive a timer started at launch.
  // unref: a timer that only forgets a finished job must not keep a process alive (a test that ran one).
  const forget = () => setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref();
  child.on('close', (code) => { clearTimeout(timer); job.done = true; job.ok = code === 0; forget(); });
  child.on('error', (err) => { clearTimeout(timer); job.buf += `\n${err.message}`; job.done = true; job.ok = false; forget(); });
  return id;
}

// Stop a running job for real: the whole process group, then its view says so.
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
  // The element polls ITSELF and replaces itself, so it stays wherever it was swapped in.
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
    <div class="msg ${job.done && !job.ok ? 'error' : 'assistant'} terminal job-view ${state}" id="job-${id}"${poll}>
      <div class="job-view-head">
        <span class="job-view-title">${job.title}</span>
        <span class="job-view-status">${status}</span>
        ${job.done ? '' : `<button type="button" class="job-view-btn" title="Stop this job — the process is killed"
                hx-post="/actions/job-stop" hx-vals='{"id":"${id}"}' hx-target="#job-${id}" hx-swap="outerHTML"
                hx-confirm="Stop this job? The running process is killed."><span uk-icon="icon: ban; ratio: .7"></span></button>`}
      </div>
      ${progress}
      <pre class="terminal-pre">${esc(text) || '…'}</pre>
      ${job.done ? `<p class="job-done-note">${job.ok ? '✅ Done — the process finished. You can close this window.' : '❌ The process failed — the output above says where.'}</p>` : ''}
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
// with a pointer rather than a terminal that follows the user around. The session
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
function hostSessionsFile({ anyAge = false } = {}) {
  const { ROOT } = require('./workspaces');
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.screens', 'host-sessions.json'), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.at !== 'number') return null;
    // anyAge: what the runner last said, also once it stopped saying it. A session it listed then is a session on the
    // machine, which the dashboard cannot reach while the runner is away (screen-verbs.js).
    return anyAge || (Date.now() - data.at) < 15000 ? data : null;
  } catch (_) { return null; }
}

async function hostRunnerUp() {
  return !!hostSessionsFile();
}

/**
 * Ask the runner for a verb on a session (stop, stuff, detach, wipe): over its unix socket in the store, the way a
 * terminal attaches through it (#558), else through the mailbox in the same folder. Both are the folder the dashboard's
 * container shares with the machine, so neither needs the network nor the machine's process space. The runner's answer
 * ({ ok, error, gone, … }, with `status` when it came over the socket), or null when neither reached it.
 */
async function hostRunnerAsk(action, payload = {}, { timeoutMs = 15000 } = {}) {
  const { ROOT } = require('./workspaces');
  const store = path.join(ROOT, '.screens');
  const sock = path.join(store, 'runner.sock');
  let token = '';
  let isSock = false;
  try { token = fs.readFileSync(path.join(store, '.runner-token'), 'utf8').trim(); } catch (_) { token = ''; }
  try { isSock = fs.statSync(sock).isSocket(); } catch (_) { isSock = false; }
  if (token && isSock) {
    const answer = await new Promise((resolve) => {
      const body = JSON.stringify(payload || {});
      const req = require('http').request({ socketPath: sock, path: `/${action}`, method: 'POST', timeout: timeoutMs,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-runner-token': token } }, (res) => {
        let out = '';
        res.on('data', (d) => { out += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(out); } catch (_) { json = null; }
          resolve(json && typeof json === 'object' ? { status: res.statusCode, ...json } : null);
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
      req.end(body);
    });
    if (answer) return answer;
  }
  return hostRunnerRequest(action, payload, { timeoutMs });
}

/** Ask the runner to do something, through the folder both sides can see. */
async function hostRunnerRequest(action, payload, { timeoutMs = 30000 } = {}) {
  // Nobody is there to answer: say so at once rather than after the timeout. A stop is still owed
  // when the session is one of the dashboard's own screen (a lingering session about to be replaced).
  if (!(await hostRunnerUp())) {
    return action === 'stop' && payload && payload.session ? stopOwnScreen(payload.session) : null;
  }
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

// --------------------------------------------------- who runs a command --
// A command the dashboard starts runs in a screen session, and nowhere else. It is offered, in this
// order, to:
//   1. a plugin that registered as a runner (api.addRunner): it runs the command its own way and
//      answers with the result, or declines with null;
//   2. the host runner below (the dashboard's own screen sessions on the machine);
//   3. screen where the dashboard itself runs: its container (screen is in the image), or the
//      machine when the dashboard is run there with node.
// There is no run in the page. When none of the three can start a session the command is not
// started, and the answer says what is missing, the step that fixes it, and the line to copy.
const runners = [];        // async (opts + session) -> result | null

/** Register a plugin as a runner of the dashboard's commands (what api.addRunner does). */
function addRunner(fn) {
  if (typeof fn === 'function') runners.push(fn);
}

async function pluginRun(opts, session) {
  for (const fn of runners) {
    try {
      const answer = await insideRunner.run(true, () => fn({ ...opts, session }));
      if (answer && typeof answer === 'object') return { session, ...answer };
    } catch (err) {
      // A runner that throws must not lose the run: the next one, or the dashboard, takes it. That is also
      // where a runner that tried to start a job in the page ends up: refused before anything ran.
      console.error(`a plugin's runner failed on ${session}: ${err.message}`);
    }
  }
  return null;
}

/** Is screen installed where the dashboard runs? Asked on every start: installing it needs no restart. */
async function ownScreenUp() {
  const out = await run('screen', ['--version'], process.env.HOME || '/', { timeoutMs: 10 * 1000 });
  return out.code !== -1;
}

// The sessions this process is starting right now. Two identical requests at one moment (a double click, two
// tabs) both asked `screen -ls`, both found nothing and both started: six presses were six copies of one
// command, six builds into one folder. Asking and starting are one step for this process now: a start of a
// session that is being started is answered "already running"; once it has started, `screen -ls` (or the
// host runner) says so as before.
const starting = new Set();

async function startInScreen(opts) {
  const session = screenSessionName(opts.project, opts.verb, opts.workspace);
  if (starting.has(session)) return { ok: false, session, already: true, where: 'dashboard' };
  starting.add(session);
  try {
    return await startInScreenOnce(opts, session);
  } finally {
    starting.delete(session);
  }
}

async function startInScreenOnce(opts, session) {
  const started = await startInScreenWhere(opts, session);
  // Noted, so the Screens page can say what ran here once it is gone (screen-notes.mts). A command that ran Claude
  // Code with an id (`--session-id`, `--resume`) is noted as the conversation it holds.
  if (started && started.ok) {
    const { ROOT } = require('./workspaces');
    const notes = require('./screen-notes.mts');
    const line = require('./linger.mts').withoutLinger(opts.cmdLine || '');
    const claude = notes.claudeIdIn(line);
    notes.noteStarted(path.join(ROOT, '.screens'), {
      session: started.session || session, dir: opts.projectDir, workspace: opts.workspace, project: opts.project,
      kind: claude ? 'claude' : 'command', what: line || opts.label || '', claude,
    });
  }
  return started;
}

async function startInScreenWhere(opts, session) {
  const { project, projectDir, ownerDir, verb, cmdLine, label, workspace } = opts;
  const { ROOT } = require('./workspaces');
  const taken = await pluginRun({ project, projectDir, ownerDir, verb, cmdLine, label, workspace }, session);
  if (taken) return taken;
  const logDir = path.join(ROOT, '.screens');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) { /* exists */ }
  const logFile = path.join(logDir, `${session}.log`);
  // The row's SCREENS group reads this to know which sessions are its own. It
  // is the PROJECT the work belongs to, which is not always where the command
  // runs: a workspace script like cmd-tools-backup.sh runs from the workspace
  // folder and takes the project as an argument.
  try { fs.writeFileSync(path.join(logDir, `${session}.cwd`), `${ownerDir || projectDir}\n`); } catch (_) { /* best effort */ }

  // Sessions belong on the machine when its runner is up: that is where the display, the browser
  // an agent drives, and the user's own terminal are — `screen -r <name>` just works there.
  if (await hostRunnerUp()) {
    const answer = await hostRunnerRequest('start',
      { session, dir: projectDir, owner: ownerDir || projectDir, cmd: cmdLine });
    if (answer && answer.already) return { ok: false, session, already: true, where: 'host' };
    if (answer && answer.ok) return { ok: true, session, label, where: 'host' };
    if (answer) return { ok: false, session, why: answer.error || 'the host runner refused it', where: 'host' };
    // No answer in time: the runner's list is fresh and the runner itself is not there. The dashboard's own screen is next.
  }
  if (await ownScreenUp()) return startInOwnScreen({ session, projectDir, cmdLine, label, logFile });
  // Nothing to run it in. Never the page: the caller is told, with the line to run by hand.
  return { ok: false, session, noScreen: true, cmdLine, dir: projectDir };
}

/** The sessions of screen where the dashboard runs: [{ pid, session }]. */
async function ownScreens() {
  const live = await run('screen', ['-ls'], process.env.HOME || '/', { timeoutMs: 10 * 1000 });
  // `screen -ls` prints:  \t<pid>.<name>\t(<date>)\t(<state>)
  return String(live.stdout || '').split('\n').map((l) => l.match(/^\s+(\d+)\.(\S+)\s/)).filter(Boolean)
    .map((m) => ({ pid: m[1], session: m[2] }));
}

/** Stop one of them: the whole name, never one that merely starts alike. */
async function stopOwnScreen(session) {
  const row = (await ownScreens()).find((r) => r.session === session);
  if (!row) return { ok: false, error: 'no such session' };
  const out = await run('screen', ['-S', `${row.pid}.${session}`, '-X', 'quit'], process.env.HOME || '/', { timeoutMs: 10 * 1000 });
  return { ok: out.ok };
}

/** A session where the dashboard itself runs. No shell reads the line on its way: it reaches bash as one argument. */
async function startInOwnScreen({ session, projectDir, cmdLine, label, logFile }) {
  // The whole name, never one that merely starts alike.
  const names = (await ownScreens()).map((r) => r.session);
  if (names.includes(session)) {
    return { ok: false, session, already: true, where: 'dashboard' };
  }
  try { fs.writeFileSync(logFile, ''); } catch (_) { /* tee creates it */ }
  // Braces group the whole line before the pipe, so every part is logged.
  const inner = `{ ${cmdLine} ; } 2>&1 | tee -a ${JSON.stringify(logFile)}`;
  // A session of its own: not a child of a Claude Code session that started this dashboard (session-env.js).
  const out = await run('screen', ['-c', SCREENRC, '-dmS', session, 'bash', '-lc', inner], projectDir,
    { timeoutMs: 30 * 1000, env: require('./session-env').sessionEnv(jobEnv()) });
  if (!out.ok) return { ok: false, session, why: String(out.stderr || out.stdout).trim().slice(-200) || 'screen refused to start it', where: 'dashboard' };
  return { ok: true, session, label, where: 'dashboard' };
}

/** The one shape every action uses: start the command in a screen session and answer with where
 *  to watch it. Nothing the dashboard runs is drawn in the page — it is a session on the Screens page. */
async function screenAction(send, opts) {
  const started = await startInScreen(opts);
  return send(screenStartedHtml(started, opts.label, opts.project || opts.workspace),
    started.ok ? 200 : (started.already ? 409 : 500));
}

/** Where a session is read: the Screens page, on that session. It also answers for one that has ended. */
function screensLink(session) {
  return `/screens?session=${encodeURIComponent(session)}`;
}

/** A hidden element that asks whether a session is done and, when it is, tells the page its lists
 *  changed (`refresh-projects`). For a step whose result the page it was pressed on must show: the
 *  session is detached, so nothing else would tell that page. It stays in the output area while
 *  the notice beside it goes to the top and fades. */
function sessionWatchHtml(session) {
  return `<span hidden class="session-watch" hx-get="/fragments/session-done/${encodeURIComponent(session)}" hx-trigger="every 2s" hx-swap="outerHTML"></span>`;
}

/** No screen session can be started: what is missing, the step that fixes it, the line to copy.
 *  `flash-stay` keeps it until it is closed: a command to copy must not fade while it is being read. */
function noScreenHtml(result, label) {
  const { tildePath } = require('./format.mts');
  const { ROOT } = require('./workspaces');
  const root = tildePath(ROOT);
  const dir = result.dir ? tildePath(result.dir) : root;
  const line = `cd ${dir} && ${require('./linger.mts').withoutLinger(result.cmdLine || '')}`;
  return `<div class="msg error flash-now flash-stay no-screen"><div class="no-screen-body">
      <strong>${esc(label)}</strong> was not started: a command runs in a screen session, and none can be started here.
      <br><strong>Missing:</strong> <code>screen</code> is not installed where the dashboard runs, and no runner is up.
      <br><strong>Fix:</strong> <code>bash ${esc(root)}/core/scripts/install.sh</code> installs it (on Debian or Ubuntu: <code>sudo apt install -y screen</code>). Then press it again: nothing needs a restart.
      <br><span class="uk-text-meta">For sessions on your own machine while the dashboard is in its container: <code>bash ${esc(root)}/core/workspace-app/scripts/screen-host.sh --start</code>.</span>
      <div class="uk-margin-small-top">Or run it in your own terminal:</div>
      <div class="uk-flex uk-flex-middle no-screen-line" style="gap:.5rem">
        <code style="flex:1">${esc(line)}</code>
        <button type="button" class="uk-button uk-button-default uk-button-small copy-cmd" data-copy="${esc(line)}"><span uk-icon="icon: copy; ratio: .7"></span> Copy</button>
      </div>
    </div></div>`;
}

/** The standard answer: what started, where to watch it.
 *
 *  `flash-now` marks these as a RESULT rather than content. It matters because 37 of the
 *  buttons that start a session post into #editor-modal-body — Remove, Clone, Restore and
 *  the item forms all open a modal, and the response replaces that form. ui.js otherwise
 *  leaves anything inside the modal alone, which is right for an editor and wrong here:
 *  the modal stayed open holding a sentence about a session that had already started. */
function screenStartedHtml(result, label, project) {
  // A plugin's runner answers in its own words.
  if (result.html) return result.html + (result.watch && result.ok ? sessionWatchHtml(result.session) : '');
  if (result.noScreen) return noScreenHtml(result, label);
  if (result.already) {
    return `<div class="msg error flash-now"><span class="notice-text"><code>${esc(label)}</code> is already running on <strong>${esc(project)}</strong> — <a href="${screensLink(result.session)}">Open in Screens</a></span></div>`;
  }
  if (!result.ok) {
    return `<div class="msg error flash-now">Could not start <code>${esc(label)}</code>: ${esc(result.why || 'unknown error')}</div>`;
  }
  // A notice is read in a glance, so it says what started, on what, and where to look —
  // and stops. The session id is what `screen -r` needs, and the Screens page prints
  // it beside a live terminal; repeating it here is what turned one sentence into a
  // paragraph, and a paragraph into something that reads as an error.
  // `data-reload-on-close` is why the row for a project you just built appears without
  // anyone pressing anything: the session is detached, so the page that started it has
  // no idea the list changed. Only on the success path — an error notice reloading the
  // page would take the message away before it could be acted on.
  // One span, so the sentence wraps as a sentence on a narrow screen instead of losing its link off the edge.
  // `watch: true`: the page is told when the session is done instead of being reloaded as the notice leaves.
  return `<div class="msg assistant flash-now"${result.watch ? '' : ' data-reload-on-close="1"'}><span class="notice-text"><code>${esc(label)}</code> started on <strong>${esc(project)}</strong> — <a href="${screensLink(result.session)}">Open in Screens</a></span></div>${result.watch ? sessionWatchHtml(result.session) : ''}`;
}

module.exports = {
  SCREENRC, screenCmd,
  screenWrap,
  run, jobs, runningJobKey, startJob, stopJob, jobFragment,
  startInScreen, startInOwnScreen, stopOwnScreen, ownScreenUp, screenStartedHtml, screensLink, sessionWatchHtml, screenSessionName, screenAction, addRunner,
  hostRunner, hostRunnerCall, hostRunnerUp, hostRunnerRequest, hostRunnerAsk, hostSessionsFile,
  // Not job machinery, but they travelled inside the same span of server.js and every
  // caller of them also calls the runner. They move properly in the next split.
  ddevProjectName, listProjects, listProjectsDetailed,
};
