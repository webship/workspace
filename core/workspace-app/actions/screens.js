/**
 * The screen-session actions: watch a session's log live, or stop it. The
 * domain lives in ../screens, shared with the modal and the Screens page.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { esc } = require('../html.mts');
const { startJob, stopJob, jobFragment, runningJobKey, hostRunnerUp, hostRunnerRequest } = require('../jobs');
const { screenLogFor, screensGridHtml, screenTargetDir, defaultSessionName } = require('../screens');
const { screenVerb, wipeEverywhere } = require('../screen-verbs');
const claudeSessions = require('../claude-sessions');
const claudeArgs = require('../claude-args.mts');
const screenNotes = require('../screen-notes.mts');
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
  // What the session's note keeps (screen-notes.mts): the conversation it holds and the options it ran with.
  let claudeId = '';
  let claudeFlags = [];
  if (kind === 'claude') {
    // Claude Code interactively, in the real PTY screen provides. The field is
    // the prompt it opens with; a prompt template brings its own flags along,
    // so the session runs the same command that prompt file documents
    // (typically --permission-mode bypassPermissions).
    // The flags are the CLI's own, read from `claude --help` (claude-args.mts) rather than typed into a
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
    // A new conversation gets its id HERE, with --session-id, so the note knows it from the first second: when
    // the screen is gone, the note is what still says which conversation it held, and Resume reopens it.
    claudeId = resumable || crypto.randomUUID();
    claudeFlags = words;
    const resumeFlag = resumable ? `--resume ${resumable}` : `--session-id ${claudeId}`;
    // The opening prompt is free text, so it reaches claude through a private file and `$(cat …)`, never as
    // a double-quoted word in the line: there `$(…)` and backticks in it would be RUN by the shell.
    const promptFile = command ? writePromptFile(fullSession, command) : '';
    inner = (command
      ? `exec claude ${resumeFlag} ${flags} "$(cat ${shq(promptFile)})"`
      : `exec claude ${resumeFlag} ${flags}`).replace(/ {2,}/g, ' ').trim();
  } else if (kind === 'shell' || !command) {
    inner = 'exec bash -l';
  } else {
    // Braces keep the WHOLE command one unit, and the runner logs it: it pipes every line that does not start with
    // `exec ` through tee into this same log. Teed here as well, every line of the log was written twice, which is
    // how Read on a past session showed it.
    inner = `{ ${command} ; }`;
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
  const noteKind = kind === 'claude' ? 'claude' : (kind === 'shell' || !command) ? 'shell' : 'command';
  screenNotes.noteStarted(logDir, {
    session: fullSession, dir, workspace: known.WEBSHIP_WORKSPACE, project: known.WEBSHIP_PROJECT, kind: noteKind,
    what: noteKind === 'claude' ? `claude ${claudeFlags.join(' ')}`.trim() + (command ? ' (with an opening prompt)' : '')
      : noteKind === 'shell' ? 'bash -l' : command,
    claude: claudeId, flags: claudeFlags,
  });

  // Started for a work item (the form's `work_key`): the plugins note the run and say so on the item
  // if that was asked for. The dashboard itself keeps no record of what a key means.
  const workKey = String(form.work_key || '').toUpperCase();
  let posted = '';
  if (/^[A-Z][A-Z0-9]+-[0-9]+$/.test(workKey)) {
    const wm = String(form.target || '').match(/^p:([a-z0-9_-]+):(.+)$/);
    posted = await require('../plugin-loader').pluginScreenStarted({ session: fullSession, workKey,
      workspace: wm ? wm[1] : '', project: wm ? wm[2] : '', dir, form });
  }
  // A session that exists now should show up now: the badge in the topbar, the row's SCREENS menu and
  // the screens page all listen for this, so none of them waits out its own poll to admit that the
  // thing you just started is running.
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'screens-changed': { session: fullSession } })); } catch (_) { /* headers already sent */ }
  return send(posted + await screensGridHtml());
}

// The rest of the screen(1) verbs the page offers, each one command on the session:
//   detach    screen -X detach     — drop every other client
//   interrupt screen -X stuff ^C   — interrupt what runs inside
//   reset     screen -X stuff …    — type a printf of the mode resets at its prompt
//   stop      screen -X quit       — end it and whatever runs inside
//   wipe      screen -wipe         — forget dead sessions
// Screen here does them for the sessions it lists; the host runner does them for the sessions on the machine, which
// screen in the dashboard's container cannot reach since its container has a process space of its own (#564).
// screen-verbs.js decides which, and says why when neither can.

/**
 * What a page says when a verb was not done: the runner is not up (the same words as a start that needs it), the
 * runner is too old for it, or what screen said, with the command to type on the machine when it keeps failing.
 */
function verbFailedHtml(session, out, verbLine) {
  if (out.runnerDown) return runnerDownHtml();
  if (out.runnerOld) return runnerOldHtml();
  const said = String(out.stderr || out.stdout || '').trim();
  const hint = out.gone ? '' : `\nIf this keeps failing, run it in your terminal: screen -S ${session} -X ${verbLine}`;
  return `<div class="msg error">Could not reach ${esc(session)}: ${esc(`${said}${hint}`.slice(-300))}</div>`;
}

/** The status of an answer that was not done: 503 when the runner is what is missing, else 500. */
const verbFailedStatus = (out) => (out.runnerDown || out.runnerOld ? 503 : 500);

function runnerOldHtml() {
  return '<div class="msg error">The screen runner on your machine is from an older release and cannot do this yet. '
    + 'Restart it once, and the sessions keep running: <code>bash ~/workspace/core/workspace-app/scripts/screen-host.sh --restart</code></div>';
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
    await wipeEverywhere();
    return send(await screensGridHtml());
  }
  if (!/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
  if (pathname === '/actions/screen-reset-modes') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Resetting types a command into the session, so it asks first.</div>', 400);
    const out = await screenVerb(session, 'stuff', { text: `printf "${MODE_RESETS}"\n` });
    return send(out.ok
      ? `<div class="msg assistant">Cleared the mouse and paste modes on <strong>${esc(session)}</strong>.
         Every terminal attached to it, here and in a real terminal, scrolls normally again.
         <p class="uk-text-meta">It typed <code>printf</code> at the session's prompt — if a full-screen program was running
         rather than a shell, that line went to the program instead and nothing was reset.</p></div>`
      : verbFailedHtml(session, out, 'stuff'), out.ok ? 200 : verbFailedStatus(out));
  }
  const detach = pathname === '/actions/screen-detach';
  const out = detach ? await screenVerb(session, 'detach') : await screenVerb(session, 'stuff', { text: '\x03' });
  const what = detach ? 'Detached every other client from' : 'Sent Ctrl-C to';
  return send(out.ok
    ? `<div class="msg assistant">${what} <strong>${esc(session)}</strong>.</div>`
    : verbFailedHtml(session, out, detach ? 'detach' : 'stuff ^C'), out.ok ? 200 : verbFailedStatus(out));
}

async function screen_watch_or_stop({ form, send, pathname, res }) {
  const session = String(form.session || '');
  if (!/^[a-z0-9][a-zA-Z0-9_.-]*$/.test(session)) return send('<div class="msg error">Not a screen session name.</div>', 400);
  if (pathname === '/actions/screen-stop') {
    if (form.confirm !== 'yes') return send('<div class="msg error">Stopping requires confirmation.</div>', 400);
    const out = await screenVerb(session, 'stop');
    // A session on the machine while its runner is away: nothing here can reach it, and saying it stopped would be false.
    if (out.runnerDown) return send(runnerDownHtml(), 503);
    if (!out.ok) {
      // A dead socket has no process to quit — `screen -wipe` is what clears it, here and on the machine.
      await wipeEverywhere();
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
  // Followed while the session is there: screen here lists it, or the host runner does (scripts/session-alive.js). It was
  // `screen -ls | grep` here, which lists only the container's own sessions since #564, so the log of a session on the
  // machine stopped after a second.
  const alive = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname, '..', 'scripts', 'session-alive.js'))} ${session} ${JSON.stringify(ROOT)}`;
  const shellLine = [
    `tail -n +1 -F ${JSON.stringify(log)} 2>/dev/null & TP=$!`,
    `while ${alive}; do sleep 3; done`,
    `sleep 1; kill $TP 2>/dev/null`,
    `echo; echo "--- the session ended; full log: ${path.basename(log)} ---"`,
  ].join('; ');
  // Keyed, so clicking Watch twice re-shows the running tail instead of
  // stacking another one against the same log.
  const key = `watch:${session}`;
  const existing = runningJobKey(key);
  if (existing) return send(jobFragment(existing).html);
  const id = startJob(`📺 Watch <strong>${esc(session)}</strong>`, 'bash', ['-c', shellLine], process.env.HOME,
    { timeoutMs: 12 * 60 * 60 * 1000, key });
  return send(jobFragment(id).html);
}

/**
 * A past Claude Code session, picked up again: a new screen in the folder it ran in, with
 * `claude --resume <id>` and the options it was started with (checked against `claude --help` when it started,
 * and against the same shape again here). Its name when that is free, else the name and a short id.
 *
 * Refused when the folder is gone, when the conversation has no transcript, and when the conversation is open in
 * a running screen already: two Claude Code processes on one conversation write over each other's turns.
 */
async function screen_resume({ form, send, res }) {
  const store = path.join(ROOT, '.screens');
  const note = screenNotes.readNote(store, String(form.note || ''));
  if (!note) return send('<div class="msg error">No such past session: it was forgotten.</div>', 404);
  if (note.kind !== 'claude' || !claudeSessions.isSessionId(note.claude)) {
    return send('<div class="msg error">Only a Claude Code session can be resumed: it is a conversation, and a shell or a command is not.</div>', 400);
  }
  const dir = String(note.dir || '');
  if (!dir || !(dir === ROOT || dir.startsWith(ROOT + path.sep)) || !fs.existsSync(dir)) {
    return send(`<div class="msg error">Its folder <code>${esc(dir || '?')}</code> is not in this workspace any more, so it cannot be picked up there.</div>`, 409);
  }
  let size = 0;
  try { size = fs.statSync(claudeSessions.transcriptFile(dir, note.claude)).size; } catch (_) { size = 0; }
  if (!size) return send(`<div class="msg error">That conversation has no transcript in <code>${esc(dir)}</code>, so <code>claude --resume</code> cannot open it.</div>`, 409);
  const flags = Array.isArray(note.flags) ? note.flags.map(String) : [];
  if (flags.some((w) => !claudeArgs.SAFE_VALUE.test(w) || /^--(resume|continue|session-id)$/.test(w))) {
    return send('<div class="msg error">The options noted for it are not ones this dashboard writes, so it is not started with them.</div>', 400);
  }
  const screens = require('../screens');
  const live = await screens.liveNames();
  // Which conversation each running screen holds: the newest note of its name.
  const runningNote = new Map();
  for (const n of screenNotes.allNotes(store)) if (!runningNote.has(n.session)) runningNote.set(n.session, n);
  const open = live.map((name) => runningNote.get(name)).find((n) => n && n.claude === note.claude);
  if (open) {
    return send(`<div class="msg error">That conversation is open in <strong>${esc(open.session)}</strong> already. Two Claude Code sessions on one conversation write over each other.
      <button type="button" class="uk-button uk-button-default uk-button-small" data-open-terminal="${esc(open.session)}">Open its terminal</button></div>`, 409);
  }
  let session = note.session;
  while (live.includes(session)) session = `${note.session.slice(0, 54)}-${crypto.randomUUID().slice(0, 4)}`;
  const vars = Object.entries({ WEBSHIP_WORKSPACE: note.workspace || '', WEBSHIP_PROJECT: note.project || '', WEBSHIP_WORKSPACE_DIR: dir })
    .map(([k, v]) => `${k}=${shq(v)}`).join(' ');
  const inner = `exec env ${vars} claude --resume ${note.claude} ${flags.join(' ')}`.replace(/ {2,}/g, ' ').trim();
  if (!(await hostRunnerUp())) return send(runnerDownHtml(), 503);
  const answer = await hostRunnerRequest('start', { session, dir, owner: dir, cmd: inner });
  if (!answer) return send(runnerDownHtml(), 503);
  if (answer.already) return send(`<div class="msg error">A session called <strong>${esc(session)}</strong> is already running.</div>`, 409);
  if (!answer.ok) return send(`<div class="msg error">Could not start it: <pre>${esc(String(answer.error || '').slice(-250))}</pre></div>`, 500);
  screenNotes.noteStarted(store, {
    session, dir, workspace: note.workspace, project: note.project, kind: 'claude',
    what: `claude --resume ${note.claude} ${flags.join(' ')}`.trim(), claude: note.claude, flags, resumedFrom: note.id,
  });
  try { res.setHeader('HX-Trigger', JSON.stringify({ 'screens-changed': { session } })); } catch (_) { /* headers already sent */ }
  const title = claudeSessions.titleOf(claudeSessions.transcriptFile(dir, note.claude));
  const notice = `<div class="msg assistant screen-resumed">Resumed ${title ? `“${esc(screens.plainText(title))}” ` : 'the conversation '}in a new screen,
      <strong>${esc(session)}</strong>.
      <button type="button" class="uk-button uk-button-primary uk-button-small" data-open-terminal="${esc(session)}"
        aria-label="${esc(`Open the terminal of ${session}`)}"><span uk-icon="icon: laptop; ratio: .8"></span> Open terminal</button></div>`;
  // The running list picks the new screen up from screens-changed, like a session started from New screen.
  return send(notice);
}

/**
 * Forget a past session: its note goes, the conversation and the log stay. Answers with the list again, also for a
 * note that is gone already: either way it is off the list, and the answer replaces the list it was pressed in.
 */
async function screen_forget({ form, send }) {
  screenNotes.forgetNote(path.join(ROOT, '.screens'), String(form.note || ''));
  return send(await require('../screens').pastSessionsHtml());
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
  '/actions/screen-resume': screen_resume,
  '/actions/screen-forget': screen_forget,
  '/actions/screen-detach': screen_verb,
  '/actions/screen-reset-modes': screen_verb,
  '/actions/screen-interrupt': screen_verb,
  '/actions/screen-wipe': screen_verb,
  '/actions/screen-watch': screen_watch_or_stop,
  '/actions/screen-stop': screen_watch_or_stop,
  verbFailedHtml, verbFailedStatus, runnerDownHtml,
};
