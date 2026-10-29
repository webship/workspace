/**
 * The screen-session actions: watch a session's log live, or stop it. The
 * domain lives in ../screens, shared with the modal and the Screens page.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { run, startJob, stopJob, jobFragment, runningJobKey, hostRunnerUp, hostRunnerRequest } = require('../jobs');
const { screenLogFor, screensGridHtml, screenTargetDir, defaultSessionName } = require('../screens');
const claudeSessions = require('../claude-sessions');
const claudeArgs = require('../claude-args');
const { ROOT } = require('../workspaces');

// A new session: named by the user, started detached in a directory the
// server resolves from a target token (never a path from the browser), with
// its output teed to the workspace's own log store.
const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** The prompt of a session, kept beside its log with this user's permissions only. */
function writePromptFile(session, text) {
  const dir = path.join(ROOT, '.screens', 'prompts');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${session}.txt`);
  fs.writeFileSync(file, text, { mode: 0o600 });
  return file;
}

async function screen_new({ form, send, res }) {
  // An empty name is not a mistake: it means "call it after where it runs", which is what the form
  // pre-fills anyway. Refusing it made the one field nobody wants to think about the one that fails.
  const session = String(form.session || '').trim() || defaultSessionName(form.target);
  if (!/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(session) || session.length > 60) {
    return send('<div class="msg error">A session name starts with a lowercase letter or digit and holds only letters, digits, - _ and . (60 max).</div>', 400);
  }
  const dir = screenTargetDir(form.target);
  if (!dir) return send('<div class="msg error">Unknown place to run in.</div>', 400);
  // The name says where it runs, exactly like the sessions the row's commands
  // start: <workspace>--<project>--<name>. A target of the workspace root or a
  // folder contributes only what it has.
  const target = String(form.target || '');
  const pm = target.match(/^p:([a-z0-9_-]+):(.+)$/);
  const wm = target.match(/^ws:([a-z0-9_-]+)$/);
  const prefix = pm ? `${pm[1]}--${pm[2]}--` : wm ? `${wm[1]}--` : '';
  // The form pre-fills the name with where it runs, so a name that already says it is not said twice:
  // `dev--ha1x00b1` must not become `dev--ha1x00b1--dev--ha1x00b1`.
  const said = prefix && (`${session}--` === prefix || session.startsWith(prefix));
  const fullSession = `${said ? '' : prefix}${session}`.toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').slice(0, 60);
  const logDir = path.join(ROOT, '.screens');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) { /* exists */ }
  const logFile = path.join(logDir, `${fullSession}.log`);
  const command = String(form.command || '').trim();
  const kind = String(form.kind || (command ? 'command' : 'shell'));
  let inner;
  if (kind === 'claude') {
    // Claude Code interactively, in the real PTY screen provides. The field is
    // the prompt it opens with; a prompt template brings its own flags along,
    // so the session runs the same command that prompt file documents
    // (typically --permission-mode bypassPermissions).
    // The flags are the CLI's own, read from `claude --help` (claude-args.js) rather than typed into a
    // free-text box: every one that arrives has to be an option that help printed, and every value has
    // to fit the shape that option documented. A value that does not is REFUSED by name — a flag that
    // silently did nothing is worse than one that says why.
    const { options, error } = await claudeArgs.claudeOptions();
    if (error) {
      return send(`<div class="msg error">The Claude Code options could not be read on this machine: ${esc(error.slice(0, 200))}</div>`, 503);
    }
    const { words, problems } = claudeArgs.flagsFromForm(options, form);
    if (problems.length) {
      return send(`<div class="msg error">${problems.map((x) => esc(x)).join('<br>')}</div>`, 400);
    }
    const flags = words.join(' ');
    // Resuming an existing conversation, by id: `claude --resume <id>` from the same directory. The id
    // is checked against the uuid shape before it reaches a shell line, and only a session that really
    // exists for THIS directory is accepted — an id from another project would resume nothing and say
    // so far from here.
    // The checkbox is what turns it on; the select only says which one. Without the checkbox a select
    // that was left on its default would resume a session nobody asked to resume.
    const wanted = form.resume_on ? String(form.resume || '').trim() : '';
    const resumable = wanted && claudeSessions.isSessionId(wanted)
      && claudeSessions.sessionsFor(dir, { limit: 200 }).some((x) => x.id === wanted)
      ? wanted : '';
    if (wanted && !resumable) {
      return send(`<div class="msg error">No Claude session <code>${esc(wanted.slice(0, 40))}</code> in <code>${esc(dir)}</code> to resume.</div>`, 400);
    }
    const resumeFlag = resumable ? `--resume ${resumable}` : '';
    // The opening prompt is free text, so it reaches claude through a private file and `$(cat …)`, never as
    // a double-quoted word in the line: there `$(…)` and backticks in it would be RUN by the shell.
    const promptFile = command ? writePromptFile(fullSession, command) : '';
    inner = (command
      ? `exec claude ${resumeFlag} ${flags} "$(cat ${shq(promptFile)})"`
      : `exec claude ${resumeFlag} ${flags}`).replace(/ {2,}/g, ' ').trim();
  } else if (kind === 'shell' || !command) {
    inner = 'exec bash -l';
  } else {
    // Braces group the WHOLE command before the pipe: without them only the
    // last segment of `a; b` is logged.
    inner = `{ ${command} ; } 2>&1 | tee -a ${JSON.stringify(logFile)}`;
  }
  // The session knows where it was started without being told: the workspace, the project and the folder
  // are in its environment, so a shell, a command or the agent never has to ask which workspace this is.
  const sq = shq;
  const known = { WEBSHIP_WORKSPACE: pm ? pm[1] : wm ? wm[1] : '', WEBSHIP_PROJECT: pm ? pm[2] : '', WEBSHIP_WORKSPACE_DIR: dir };
  const vars = Object.entries(known).map(([k, v]) => `${k}=${sq(v)}`).join(' ');
  // The runner keeps a command that starts with `exec ` interactive and pipes anything else through tee,
  // which turns claude into --print and a shell into a pipe, so the variables go INSIDE the exec.
  inner = /^exec /.test(inner) ? `exec env ${vars} ${inner.slice(5)}` : `export ${vars}; ${inner}`;
  // Sessions run on the machine, not in this container — so `screen -r` in the
  // user's own terminal reaches them, and a browser an agent opens is a window
  // on their desktop.
  if (!(await hostRunnerUp())) return send(runnerDownHtml(), 503);
  const answer = await hostRunnerRequest('start', { session: fullSession, dir, owner: dir, cmd: inner });
  if (!answer) return send(runnerDownHtml(), 503);
  if (answer.already) return send(`<div class="msg error">A session called <strong>${esc(fullSession)}</strong> is already running.</div>`, 409);
  if (!answer.ok) return send(`<div class="msg error">Could not start it: <pre>${esc(String(answer.error || '').slice(-250))}</pre></div>`, 500);

  // Started for a Jira workitem: note the run, and say so on the workitem if that was asked for.
  //
  // The note is written whether or not anything is posted — a workitem gets worked more than once, and
  // `screen -ls` answers only for the ones still running, so a finished run would otherwise leave
  // nothing that maps a conversation back to the task.
  const workKey = String(form.work_key || '').toUpperCase();
  let posted = '';
  if (/^[A-Z][A-Z0-9]+-[0-9]+$/.test(workKey)) {
    const runs = require('../jira-sessions');
    const wm = String(form.target || '').match(/^p:([a-z0-9_-]+):(.+)$/);
    runs.recordRun(fullSession, { key: workKey, workspace: wm ? wm[1] : '', project: wm ? wm[2] : '', dir });
    const claudeId = await runs.fillClaudeId(fullSession, dir);
    if (String(form.comment_session || '') === '1') {
      const { hubDomain } = require('../workspaces');
      const where = `https://${hubDomain()}/terminal/${encodeURIComponent(fullSession)}`;
      // Written HERE, and only the session's identity: never a transcript, an output, or anything the
      // agent said. It says where it runs, because a reader of the workitem is not necessarily at this
      // machine — and it says plainly that there is no claude.ai page, so nobody goes looking for one.
      const body = [
        `🤖 Claude Code is working on this${wm ? ` in **${wm[2]}** (${wm[1]})` : ''}.`,
        '',
        `- session: \`${fullSession}\``,
        `- watch it: ${where}`,
        ...(claudeId ? [`- resume the conversation on that machine: \`claude --resume ${claudeId}\``] : []),
        '',
        '_Started from the Webship Workspace dashboard. The session runs on that machine, not on claude.ai._',
      ].join('\n');
      const r = await require('../jira').postComment(workKey, body);
      posted = r.ok
        ? `<div class="msg assistant">Commented on <strong>${esc(workKey)}</strong> that <code>${esc(fullSession)}</code> is running.</div>`
        : `<div class="msg error">The session started, but the comment on ${esc(workKey)} did not post: <pre>${esc(r.error.slice(0, 200))}</pre></div>`;
    }
  }
  // A session that exists now should show up now: the badge in the topbar, the row's SCREENS menu and
  // the screens page all listen for this, so none of them waits out its own poll to admit that the
  // thing you just started is running.
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'screens-changed': { session: fullSession } })); } catch (_) { /* headers already sent */ }
  return send(posted + await screensGridHtml());
}

// The rest of the screen(1) verbs the page offers, each one command:
//   detach    screen -S <s> -X detach     — drop every other client
//   interrupt screen -S <s> -X stuff ^C   — interrupt what runs inside
//   wipe      screen -wipe                — forget dead sessions
// The dashboard's container has no screen sessions of its own any more, so a
// screen(1) verb is asked of the machine — falling back to the container only
// for the sessions started before the move.
async function onHostScreen(session, args) {
  const live = await require('../screens').listScreens();
  const row = live.find((s) => s.session === session);
  // Stopping goes through the host runner when the runner owns the session: it started the process
  // group and is the one that can take the whole thing down.
  if (row && row.where === 'host' && args.includes('quit')) {
    const answer = await hostRunnerRequest('stop', { session });
    if (answer && answer.ok) return { ok: true, stdout: '', stderr: '' };
  }
  // Everything else is screen's own, and screen IN HERE can reach it: `/run/screen` is shared with
  // this container, which is the same reason `screen -x` attaches at all.
  //
  // This used to refuse every verb but quit for any session marked `host` — which is every session,
  // since that is what listScreens labels them — and answer with "run it in your terminal" instead. So
  // the terminal window's Ctrl-C and Detach buttons did nothing but print a command to go and type,
  // for a session this process could drive all along. Verified from the container: `screen -S <s> -X
  // stuff` is accepted.
  const out = await run('screen', args, process.env.HOME, { timeoutMs: 10 * 1000 });
  if (out.ok) return out;
  // Only when it really fails is there something for a person to do, and then the command is the one
  // that was actually attempted rather than a reconstruction of it.
  const verb = args.slice(3).join(' ');
  return { ok: false,
    stdout: out.stdout,
    stderr: `${String(out.stderr || out.stdout || '').trim()}\nIf this keeps failing, run it in your terminal: screen -S ${session} -X ${verb}` };
}

function runnerDownHtml() {
  return '<div class="msg error">Sessions run on your machine, not in this container, and its runner is not up. '
    + 'Start it once with: <code>bash ~/workspace/core/workspace-app/scripts/screen-host.sh --start</code></div>';
}

// The modes a program turns on and does not always turn off again.
//
// A TUI asks the terminal to report the mouse (1000/1002/1003, SGR 1006/1015), to bracket pastes
// (2004) and for its own screen (1049). screen remembers the window's state and REPLAYS it to every
// display that attaches afterwards — so when the program dies without putting them back, the next
// terminal to attach has mouse reporting on with nothing consuming it, and the wheel writes
// coordinates like `<35;80;10M` into the shell instead of scrolling. It looks like a broken terminal
// and it is a mode nobody can see.
//
// There is no screen command that writes to a window's terminal: `-X echo` goes to the status line,
// and `-X stuff` goes to the program's INPUT. So the reset is what a person would type — a printf of
// the disable sequences — which is why this asks first and says so: it types a line into the session,
// and that is only harmless at a shell prompt.
const MODE_RESETS = ['?1000l', '?1001l', '?1002l', '?1003l', '?1005l', '?1006l', '?1015l', '?2004l']
  .map((m) => `\\\\033[${m}`).join('');

async function screen_verb({ form, send, pathname }) {
  const session = String(form.session || '');
  if (pathname === '/actions/screen-wipe') {
    await run('screen', ['-wipe'], process.env.HOME, { timeoutMs: 10 * 1000 });
    return send(await screensGridHtml());
  }
  if (!/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
  if (pathname === '/actions/screen-reset-modes') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Resetting types a command into the session, so it asks first.</div>', 400);
    const out = await onHostScreen(session, ['-S', session, '-X', 'stuff', `printf "${MODE_RESETS}"\n`]);
    return send(out.ok
      ? `<div class="msg assistant">Cleared the mouse and paste modes on <strong>${esc(session)}</strong>.
         Every terminal attached to it, here and in a real terminal, scrolls normally again.
         <p class="uk-text-meta">It typed <code>printf</code> at the session's prompt — if a full-screen program was running
         rather than a shell, that line went to the program instead and nothing was reset.</p></div>`
      : `<div class="msg error">Could not reach ${esc(session)}: ${esc(String(out.stderr || out.stdout).slice(-200))}</div>`, out.ok ? 200 : 500);
  }
  const args = pathname === '/actions/screen-detach'
    ? ['-S', session, '-X', 'detach']
    : ['-S', session, '-X', 'stuff', '\x03'];
  const out = await onHostScreen(session, args);
  const what = pathname === '/actions/screen-detach' ? 'Detached every other client from' : 'Sent Ctrl-C to';
  return send(out.ok
    ? `<div class="msg assistant">${what} <strong>${esc(session)}</strong>.</div>`
    : `<div class="msg error">Could not reach ${esc(session)}: ${esc(String(out.stderr || out.stdout).slice(-200))}</div>`, out.ok ? 200 : 500);
}

async function screen_watch_or_stop({ form, send, pathname, res }) {
  const session = String(form.session || '');
  if (!/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
  if (pathname === '/actions/screen-stop') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Stopping requires confirmation.</div>', 400);
    const out = await onHostScreen(session, ['-S', session, '-X', 'quit']);
    if (!out.ok) {
      // A dead socket has no process to quit — `screen -wipe` is what clears it.
      await run('screen', ['-wipe'], process.env.HOME, { timeoutMs: 10 * 1000 });
      const still = (await require('../screens').listScreens()).some((s) => s.session === session);
      if (still) return send(`<div class="msg error">Could not stop ${esc(session)}: ${esc(String(out.stderr || out.stdout).slice(-200))}</div>`, 500);
    }
    // Answer with the refreshed manager so the killed row disappears at once — and say which session
    // went, so a terminal open on it closes itself. A pane left open on a dead session is a terminal
    // you can still type into, and nothing on the other end.
    try { res.setHeader('HX-Trigger', JSON.stringify({ 'screen-killed': { session }, 'screens-changed': { session } })); } catch (_) { /* headers already sent */ }
    return send(await screensGridHtml());
  }
  const log = screenLogFor(session);
  if (!log) return send('<div class="msg error">No known log for this session — reattach in a terminal instead.</div>', 404);
  const shellLine = [
    `tail -n +1 -F ${JSON.stringify(log)} 2>/dev/null & TP=$!`,
    `while screen -ls 2>/dev/null | grep -q "[.]${session}[[:space:]]"; do sleep 3; done`,
    `sleep 1; kill $TP 2>/dev/null`,
    `echo; echo "--- the session ended; full log: ${path.basename(log)} ---"`,
  ].join('; ');
  // Keyed, so clicking Watch twice re-shows the running tail instead of
  // stacking another one against the same log.
  const key = `watch:${session}`;
  const existing = runningJobKey(key);
  if (existing) return send(jobFragment(existing).html);
  const id = startJob(`📺 Watch <strong>${esc(session)}</strong>`, 'bash', ['-c', shellLine], process.env.HOME,
    { timeoutMs: 12 * 60 * 60 * 1000, inline: true, key });
  return send(jobFragment(id).html);
}

async function job_stop({ form, send }) {
  const id = String(form.id || '');
  if (!/^[0-9]+-[a-z0-9]+$/.test(id)) return send('<div class="msg error">Not a job id.</div>', 400);
  stopJob(id);
  return send(jobFragment(id).html);
}

module.exports = {
  '/actions/job-stop': job_stop,
  '/actions/screen-new': screen_new,
  '/actions/screen-detach': screen_verb,
  '/actions/screen-reset-modes': screen_verb,
  '/actions/screen-interrupt': screen_verb,
  '/actions/screen-wipe': screen_verb,
  '/actions/screen-watch': screen_watch_or_stop,
  '/actions/screen-stop': screen_watch_or_stop,
  onHostScreen,
};
