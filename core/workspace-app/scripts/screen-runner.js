#!/usr/bin/env node
/**
 * The host screen runner.
 *
 * Screen sessions belong on the machine, not inside the dashboard's container:
 * that is where the display is, where ~/.claude lives, and where a browser an
 * agent drives can actually be watched. But the dashboard runs INSIDE the
 * container and cannot start or attach a host process — so this small server
 * stands on the host and does it on the dashboard's behalf.
 *
 *   start   POST /start   {session, dir, cmd}   -> screen -dmS on this machine
 *   list    GET  /list                          -> what `screen -ls` says here
 *   stop    POST /stop    {session}             -> screen -X quit
 *   stuff   POST /stuff   {session, text}       -> screen -X stuff: Ctrl-C, /exit, a line typed into the session
 *   detach  POST /detach  {session}             -> screen -X detach: every other client lets go
 *   wipe    POST /wipe                          -> screen -wipe: the sockets of sessions that are gone
 *   attach  WS   /attach/<session>              -> a PTY sharing that session
 *
 * on its port and on a unix socket in the store (.screens/runner.sock), which the dashboard's container reaches
 * through the folder both sides share. Every verb but attach is also taken from the mailbox (below).
 *
 * The dashboard's container has a process space of its own (webship/workspace#564): screen in there cannot reach a
 * session on this machine, and `ps` in there cannot see its processes. So every verb on a session goes through here,
 * and what only the process table tells (which sessions run Claude Code, which automation browsers are open) is
 * published from here with the list.
 *
 * It binds to 127.0.0.1 only and requires a token that lives in the workspace
 * (which the container already mounts), so the dashboard can read it and other
 * machines cannot reach it at all.
 *
 * Run it with:  bash <workspace>/core/workspace-app/scripts/screen-host.sh --start
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
// One copy of the working-vs-waiting rules, shared with the dashboard. No dependencies.
const { waitingState } = require(path.join(__dirname, '..', 'waiting'));
// And of what the process table says about a session or a browser. No dependencies either.
const { PS_ARGS, parseProcessTable, agentUnder, browsersIn } = require(path.join(__dirname, '..', 'host-processes'));

// The workspace is two levels up from this script: core/workspace-app/scripts.
const ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..', '..');
const STORE = path.join(ROOT, '.screens');
const PORT = Number(process.env.SCREEN_RUNNER_PORT || 7681);
const NAME_RE = /^[a-z0-9][a-zA-Z0-9._-]*$/;

fs.mkdirSync(STORE, { recursive: true });

// The token is the whole access control: readable by this user (and so by the
// container, which mounts this tree), unreadable by anything else.
const tokenFile = path.join(STORE, '.runner-token');
let TOKEN;
try {
  TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!TOKEN) throw new Error('empty');
} catch (_) {
  TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
}

// Who may reach the runner: this machine, and the container on the docker
// bridge — nothing from the network beyond. The socket has to listen past
// loopback for the container to arrive at all, so the peer is checked here.
const localPeer = (socket) => {
  // The unix socket in the store (below): only this user can open it, and the dashboard's container through the
  // folder it shares with this machine.
  if (socket.viaStoreSocket) return true;
  const a = String(socket.remoteAddress || '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1'
    || /^172\.(1[6-9]|2\d|3[01])\./.test(a)   // docker's default bridge ranges
    || /^10\./.test(a) || /^192\.168\./.test(a);
};

const ok = (req) => {
  if (!localPeer(req.socket)) return false;
  const given = req.headers['x-runner-token'] || '';
  // Constant-time compare: this is a local secret, but a token check that leaks
  // its answer by timing is not a token check.
  const a = Buffer.from(String(given));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function listSessions(cb) {
  execFile('screen', ['-ls'], { timeout: 10000 }, (_err, stdout) => {
    const rows = [];
    for (const line of String(stdout || '').split('\n')) {
      const m = line.match(/^\s+(\d+)\.(\S+)\s+\(([^)]*)\)(?:\s+\(([^)]*)\))?/);
      if (m) rows.push({ pid: m[1], session: m[2], started: m[3], state: m[4] || '' });
    }
    cb(rows);
  });
}

// A session, addressed by its whole name: `<pid>.<name>`, which is one session, never another. screen's own `-S <name>`
// takes any session whose name STARTS with it, so stopping `dev--site--composer-update` after it had ended quit
// `dev--site--composer-update--dry-run` instead. Null when no session has that name.
function exactSession(session, cb) {
  listSessions((rows) => {
    const row = rows.find((r) => r.session === session);
    cb(row ? `${row.pid}.${row.session}` : null);
  });
}

// The machine's process table, read at most every five seconds: the published list is rewritten every two, and what
// it carries from here (which sessions run Claude Code, which automation browsers are open) keeps for five.
const PS_TTL = 5000;
let _table = { at: 0, table: null };

function processTable(cb) {
  if (_table.table && Date.now() - _table.at < PS_TTL) return cb(_table.table);
  return execFile('ps', PS_ARGS, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
    _table = { at: Date.now(), table: parseProcessTable(err ? '' : stdout) };
    cb(_table.table);
  });
}

// The verbs this runner does, published, so the dashboard asks only for what this one can do: a runner started from
// an older release keeps its old code until it is restarted, and does not know stuff, detach or wipe.
const VERBS = ['start', 'stop', 'stuff', 'detach', 'wipe'];

// What may be typed into a session at once: the dashboard types a key, a command or a line, never a file.
const MAX_STUFF = 4096;

/**
 * A verb on a session, for both ways in (the sockets and the mailbox): `done` gets the answer to send back.
 *
 *   stop    screen -X quit     the session and whatever runs inside it end
 *   stuff   screen -X stuff    `text` is typed into the session, as a person would type it
 *   detach  screen -X detach   every client attached to it lets go; the session runs on
 *   wipe    screen -wipe       the sockets of sessions that are gone
 */
function doVerb(action, payload, done) {
  const run = (args) => execFile('screen', args, { timeout: 10000 }, (err, _o, stderr) => done(err
    ? { ok: false, error: String(stderr || err.message).trim().slice(-200) }
    : { ok: true }));
  if (action === 'wipe') {
    // `screen -wipe` exits 1 when there is nothing to wipe: only a screen that is not there is a failure.
    return execFile('screen', ['-wipe'], { timeout: 10000 }, (err) => done(err && err.code === 'ENOENT'
      ? { ok: false, error: 'screen is not installed on this machine' } : { ok: true }));
  }
  if (!['stop', 'stuff', 'detach'].includes(action)) return done({ ok: false, error: 'unknown action' });
  const session = String((payload && payload.session) || '');
  if (!NAME_RE.test(session)) return done({ ok: false, error: 'bad session name', bad: true });
  const text = action === 'stuff' ? (payload && typeof payload.text === 'string' ? payload.text : '') : '';
  if (action === 'stuff' && (!text || Buffer.byteLength(text) > MAX_STUFF)) {
    return done({ ok: false, error: `nothing to type, or more than ${MAX_STUFF} bytes`, bad: true });
  }
  return exactSession(session, (target) => {
    if (!target) return done({ ok: false, gone: true, error: `no session called ${session} is running` });
    if (action === 'stop') return run(['-S', target, '-X', 'quit']);
    if (action === 'detach') return run(['-S', target, '-X', 'detach']);
    return run(['-S', target, '-X', 'stuff', text]);
  });
}

// The environment every screen session is created with.
//
// A full-screen TUI in a screen window needs TWO things fixed, and either one alone
// leaves it broken — this is the "I see colors" report: raw escape codes as text.
//
// 1. TERM. screen replaces $TERM in its windows with its own default, `screen`, which
//    terminfo says has EIGHT colours, however capable the real client is:
//      TERM=screen -> tput colors = 8;  TERM=xterm-256color -> 256
//    So the CLI renders for 8 colours while the far end is xterm.js.
// 2. COLORTERM is inherited UNCHANGED, so the window still claims `truecolor` and the
//    CLI emits 24-bit \e[38;2;R;G;Bm sequences. GNU screen 4.09 cannot pass those
//    through — `truecolor on` arrived in screen 5 — so it mangles them and the codes
//    reach the browser as visible text. Removing COLORTERM makes the CLI fall back to
//    256-colour codes, which screen does pass and xterm.js draws correctly.
//
// Set here rather than in a ~/.screenrc, so a machine needs no dotfile for the
// dashboard's terminals to be right. `screen -T` states the same TERM for the window.
// And without the marks of a Claude Code session that started this runner (session-env.js says why): with them, a
// Claude Code screen took itself for that session's child and saved no transcript to read or resume later.
const SESSION_ENV = { ...require(path.join(__dirname, '..', 'session-env')).sessionEnv(process.env), TERM: 'xterm-256color' };

// The screen configuration every session started here runs under. It sits beside the dashboard rather
// than in ~/.screenrc, because it belongs to these sessions and must not change what a person's own
// `screen` does. This runner lives in core/workspace-app/scripts, so the file is one level up.
const SCREENRC = path.join(__dirname, '..', 'screenrc');
delete SESSION_ENV.COLORTERM;

// The waiting flag, computed HERE because this process is on the machine with the
// sessions. The dashboard cannot do it: `screen` in its container knows nothing about
// host sessions, and — the reason this exists at all — the log file is useless for the
// sessions that matter most. A Claude Code session is started with `exec claude`, no
// `tee`, because piping a full-screen TUI produces garbage instead of an interface. So
// its .log is ZERO BYTES, and a log-reading check can never fire for an agent.
//
// `screen -X hardcopy` reads the visible window instead. Throttled per session: the
// published list is rewritten every two seconds and a subprocess per session per tick
// would be pure waste, while a question on a screen keeps for six seconds.
const WAIT_TTL = 6000;
const _waitCache = new Map();

function waitingFor(session, cb, target = session) {
  const hit = _waitCache.get(session);
  if (hit && Date.now() - hit.at < WAIT_TTL) return cb(hit.state);
  const out = path.join(STORE, `.peek-${session}`);
  execFile('screen', ['-S', target, '-X', 'hardcopy', out], { timeout: 8000 }, () => {
    let text = '';
    try { text = fs.readFileSync(out, 'utf8'); } catch (_) { text = ''; }
    try { fs.unlinkSync(out); } catch (_) { /* best effort */ }
    const lines = text.split('\n').filter((l) => l.trim());
    const state = waitingState(lines.slice(-14).join('\n'));
    _waitCache.set(session, { at: Date.now(), state });
    cb(state);
  });
}

/** listSessions, plus the waiting flag and the agent flag for each row, and the process table it read them from. */
function listSessionsWithState(cb) {
  listSessions((rows) => processTable((table) => {
    // Whether Claude Code runs in the session: only a process on this machine can tell, by its process table.
    for (const r of rows) r.agent = agentUnder(r.pid, table);
    if (!rows.length) return cb(rows, table);
    let left = rows.length;
    return rows.forEach((r) => waitingFor(r.session, (st) => {
      r.waiting = !!st.waiting;
      r.waitingWhy = st.why || '';
      if (--left === 0) cb(rows, table);
    }, `${r.pid}.${r.session}`));
  }));
}

const server = http.createServer((req, res) => {
  if (!ok(req)) return json(res, 403, { error: 'bad token' });
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/list') {
    return listSessionsWithState((rows) => json(res, 200, { sessions: rows }));
  }
  // What is on a session's screen right now, so the dashboard can tell a session that
  // is WORKING from one that is WAITING FOR A PERSON. A long agent run that has stopped
  // to ask "which of these do you want?" looks identical to one still thinking, from
  // the outside — and it will sit there until somebody notices.
  //
  // `screen -X hardcopy` writes the visible window to a file. It is read-only in every
  // sense that matters: it sends no keys and no signals, and it does not attach, so it
  // cannot steal a session from a terminal that has it open.
  if (req.method === 'GET' && url.pathname === '/peek') {
    const session = String(url.searchParams.get('session') || '');
    if (!NAME_RE.test(session)) return json(res, 400, { error: 'bad session name' });
    const out = path.join(STORE, `.peek-${session}`);
    return exactSession(session, (target) => {
      if (!target) return json(res, 200, { session, tail: '', gone: true });
      return execFile('screen', ['-S', target, '-X', 'hardcopy', out], { timeout: 10000 }, () => {
        let text = '';
        try { text = fs.readFileSync(out, 'utf8'); } catch (_) { text = ''; }
        try { fs.unlinkSync(out); } catch (_) { /* best effort */ }
        // Only the tail is of interest: a question is at the bottom of a screen, never
        // at the top, and the whole window is 50+ lines of scrollback nobody needs here.
        const lines = text.split('\n').filter((l) => l.trim());
        return json(res, 200, { session, tail: lines.slice(-14).join('\n') });
      });
    });
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, host: require('os').hostname(), screen: !!process.env.PATH });
  }
  if (req.method === 'POST' && VERBS.includes(url.pathname.slice(1))) {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) { return json(res, 400, { error: 'bad json' }); }
      if (url.pathname !== '/start') {
        return doVerb(url.pathname.slice(1), payload, (answerBody) => json(res, answerBody.bad ? 400 : 200, answerBody));
      }
      const session = String(payload.session || '');
      if (!NAME_RE.test(session)) return json(res, 400, { error: 'bad session name' });
      // start: the directory must be inside the workspace, and the command runs
      // through a login shell so the user's PATH, ~/.claude and agents apply.
      const dir = path.resolve(String(payload.dir || ROOT));
      if (!dir.startsWith(ROOT)) return json(res, 400, { error: 'directory outside the workspace' });
      if (!fs.existsSync(dir)) return json(res, 400, { error: 'no such directory' });
      const cmd = String(payload.cmd || '').trim() || 'exec bash -l';
      const logFile = path.join(STORE, `${session}.log`);
      try { fs.writeFileSync(path.join(STORE, `${session}.cwd`), `${payload.owner || dir}\n`); } catch (_) { /* best effort */ }
      listSessions((rows) => {
        if (rows.some((r) => r.session === session)) return json(res, 409, { error: 'already running' });
        const inner = /^exec /.test(cmd) ? cmd : `{ ${cmd} ; } 2>&1 | tee -a ${JSON.stringify(logFile)}`;
        startScreen(session, inner, logFile, dir, (err, _o, stderr) => {
            if (err) return json(res, 500, { error: String(stderr || err.message).slice(-200) });
            listSessions((after) => json(res, 200, {
              ok: after.some((r) => r.session === session), session, log: logFile,
            }));
          });
      });
    });
    return undefined;
  }
  return json(res, 404, { error: 'no such endpoint' });
});

// The attach socket: a PTY sharing the session, exactly like the container's own
// bridge, so the dashboard can proxy a browser terminal to a host session.
let WebSocketServer;
try { ({ WebSocketServer } = require(path.join(__dirname, '..', 'node_modules', 'ws'))); } catch (_) { /* reported below */ }
if (WebSocketServer) {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('error', () => { /* a bad frame must not stop the runner */ });
  const children = new Set();
  const attached = new Set();
  for (const sig of ['exit', 'SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      // Going away (1001), not ending the session: the dashboard tells its windows to attach again once the
      // runner is back, where a plain close would read as the session's attach ending on purpose.
      for (const w of attached) { try { w.close(1001, 'the runner is stopping'); } catch (_) { /* gone */ } }
      for (const c of children) {
        try { process.kill(-c.pid, 'SIGTERM'); } catch (_) { try { c.kill('SIGTERM'); } catch (__) { /* gone */ } }
      }
      if (sig !== 'exit') process.exit(0);
    });
  }
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const m = u.pathname.match(/^\/attach\/([a-z0-9][a-zA-Z0-9._-]*)$/);
    if (!m || !localPeer(socket) || (u.searchParams.get('token') || '') !== TOKEN) { socket.destroy(); return; }
    const session = m[1];
    const cols = Math.min(500, Math.max(20, parseInt(u.searchParams.get('cols'), 10) || 120));
    const rows = Math.min(200, Math.max(5, parseInt(u.searchParams.get('rows'), 10) || 30));
    // The session by its whole name: `screen -x <name>` attaches any session whose name starts with it, so a window
    // opened on a session that had just ended would have shown another one.
    exactSession(session, (target) => wss.handleUpgrade(req, socket, head, (ws) => {
      if (!target) {
        try { ws.send(`There is no screen to be attached matching ${session}.\r\n`); ws.close(1000); } catch (_) { /* gone */ }
        return;
      }
      // The same attach as the dashboard's own (server.js): `-A` fits the session to this window, and `script` runs
      // in a process group of its own, so closing the window ends the `screen -x` client too. Left attached, a
      // client pins the session to its size, one more for every window ever closed.
      const child = spawn('script', ['-qfc',
        `stty cols ${cols} rows ${rows} 2>/dev/null; exec screen -A -x ${target}`, '/dev/null'],
      { cwd: process.env.HOME, detached: true, env: { ...process.env, TERM: 'xterm-256color' } });
      children.add(child);
      let painted = false;
      const repaints = [250, 900, 2500, 5000].map((ms) => setTimeout(() => {
        if (!painted) execFile('screen', ['-S', target, '-X', 'redisplay'], () => { /* gone */ });
      }, ms));
      const reap = () => {
        repaints.forEach(clearTimeout);
        children.delete(child);
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {
          try { child.kill('SIGTERM'); } catch (__) { /* gone */ }
        }
      };
      child.stdout.on('data', (d) => { painted = true; try { ws.send(d); } catch (_) { /* closing */ } });
      child.stderr.on('data', (d) => { painted = true; try { ws.send(d); } catch (_) { /* closing */ } });
      attached.add(ws);
      child.on('exit', () => { repaints.forEach(clearTimeout); children.delete(child); try { ws.close(); } catch (_) { /* closed */ } });
      ws.on('close', () => attached.delete(ws));
      // An empty binary frame is a window's keepalive (terminal-keepalive.js): never typed into the session.
      ws.on('message', (d, isBinary) => { if (isBinary && !d.length) return; try { child.stdin.write(d); } catch (_) { /* gone */ } });
      ws.on('close', reap);
      ws.on('error', reap);
    }));
  });
}

// Bound past loopback ONLY so the dashboard's container can reach it; every
// request still has to come from this machine or its docker bridge AND carry
// the token from a file only this user can read.
// ---------------------------------------------------------- the mailbox --
// The dashboard's container cannot open a socket to this machine on some hosts
// (docker's bridge is firewalled), but both sides already share the workspace
// tree — so the real channel is that folder. The dashboard drops a request
// file; this picks it up, does the work, and writes the answer back. The HTTP
// server above stays for anything on this machine.
const QUEUE = path.join(STORE, 'queue');
const RESULTS = path.join(STORE, 'results');
fs.mkdirSync(QUEUE, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

function answer(id, body) {
  try { fs.writeFileSync(path.join(RESULTS, `${id}.json`), JSON.stringify(body)); } catch (_) { /* the caller times out */ }
}

// Sessions this runner is starting right now: a second request for the same name, arriving before the first
// one's session exists, is answered "already" instead of starting it a second time.
// Start a detached session whose login shell runs `inner`. No shell sits between this runner and screen: `inner`
// reaches the session's bash as one argument and is parsed once, when the session runs it. It used to go through
// `bash -lc "…"` here, where JSON quoting left $, $(…) and backticks live, so this runner's own shell expanded them
// on the host before the session existed: a backtick in a prompt ran, and a $(…) meant for the session ran here.
function startScreen(session, inner, logFile, dir, done) {
  try { fs.writeFileSync(logFile, ''); } catch (err) { return done(err, '', String(err.message)); }
  return execFile('screen', ['-c', SCREENRC, '-T', 'xterm-256color', '-dmS', session, 'bash', '-lc', inner],
    { cwd: dir, timeout: 30000, env: SESSION_ENV }, done);
}

const starting = new Set();

function handleRequest(file) {
  // Claim the request before reading it. The queue is drained on a poll and on every folder-watch event, and
  // one new file fires the watch more than once: two drains read the same request before its (asynchronous)
  // unlink landed, and a burst of 12 starts made 14 sessions. A rename is atomic, so exactly one drain wins.
  const claimed = `${file}.taken`;
  try { fs.renameSync(file, claimed); } catch (_) { return; }
  let req;
  try { req = JSON.parse(fs.readFileSync(claimed, 'utf8')); } catch (_) { return fs.unlink(claimed, () => {}); }
  fs.unlink(claimed, () => {});
  const id = String(req.id || '').replace(/[^a-zA-Z0-9._-]/g, '');
  const session = String(req.session || '');
  if (!id) return;
  // Every verb but start, the same as over the sockets: stop, stuff, detach, wipe.
  if (req.action !== 'start') return doVerb(req.action, req, (body) => answer(id, body));
  if (!NAME_RE.test(session)) return answer(id, { ok: false, error: 'bad session name' });

  if (req.action === 'start') {
    const dir = path.resolve(String(req.dir || ROOT));
    if (!dir.startsWith(ROOT)) return answer(id, { ok: false, error: 'directory outside the workspace' });
    if (!fs.existsSync(dir)) return answer(id, { ok: false, error: 'no such directory' });
    const cmd = String(req.cmd || '').trim() || 'exec bash -l';
    const logFile = path.join(STORE, `${session}.log`);
    try { fs.writeFileSync(path.join(STORE, `${session}.cwd`), `${req.owner || dir}\n`); } catch (_) { /* best effort */ }
    if (starting.has(session)) return answer(id, { ok: false, already: true });
    starting.add(session);
    return listSessions((rows) => {
      if (rows.some((r) => r.session === session)) { starting.delete(session); return answer(id, { ok: false, already: true }); }
      const inner = /^exec /.test(cmd) ? cmd : `{ ${cmd} ; } 2>&1 | tee -a ${JSON.stringify(logFile)}`;
      startScreen(session, inner, logFile, dir, (err, _o, stderr) => {
          if (err) { starting.delete(session); return answer(id, { ok: false, error: String(stderr || err.message).slice(-200) }); }
          listSessions((after) => { starting.delete(session); answer(id, { ok: after.some((r) => r.session === session), session }); });
        });
    });
  }
  return answer(id, { ok: false, error: 'unknown action' });
}

function drainQueue() {
  let files = [];
  try { files = fs.readdirSync(QUEUE).filter((f) => f.endsWith('.json')); } catch (_) { return; }
  for (const f of files) handleRequest(path.join(QUEUE, f));
}

// The published truth: what is running here, refreshed so the dashboard can
// read it without asking anything. Its mtime is also how the dashboard knows
// this runner is alive.
function publish() {
  // With the waiting flag, so the dashboard's list shows it without asking anything:
  // the file the page already reads is the one that carries it.
  listSessionsWithState((rows, table) => {
    // Written beside and renamed over: written in place, a read at that moment (it is rewritten every two
    // seconds) found an empty or half file, took the runner for down and ran the command in the container.
    try {
      const file = path.join(STORE, 'host-sessions.json');
      const tmp = `${file}.${process.pid}.tmp`;
      // With the automation browsers open on this machine (the Screens page lists them) and the verbs this runner
      // does: the dashboard's container sees neither the machine's processes nor which release this runner is.
      fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), host: require('os').hostname(), sessions: rows,
        browsers: browsersIn(table), verbs: VERBS }));
      fs.renameSync(tmp, file);
    } catch (_) { /* the dashboard will see a stale file and say so */ }
  });
}

publish();
setInterval(publish, 2000).unref?.();
setInterval(drainQueue, 500).unref?.();
try { fs.watch(QUEUE, () => drainQueue()); } catch (_) { /* the poll above covers it */ }

// A unix socket in the store as well, for the dashboard's container: it shares this folder with the machine, so it
// reaches the runner with no network in between (a firewall on docker's bridge is what made the mailbox above
// necessary) and needs no shared process namespace to attach a terminal. This user only. A path longer than a
// unix socket may be (108 bytes, with room to spare) is left out: the port and the mailbox still serve.
const SOCK = path.join(STORE, 'runner.sock');
if (Buffer.byteLength(SOCK) < 100) {
  const sockServer = http.createServer((req, res) => server.emit('request', req, res));
  sockServer.on('connection', (socket) => { socket.viaStoreSocket = true; });
  sockServer.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
  sockServer.on('error', (e) => console.error(`Not listening on ${SOCK}: ${e.message}`));
  try { fs.unlinkSync(SOCK); } catch (_) { /* none left from before */ }
  sockServer.listen(SOCK, () => {
    try { fs.chmodSync(SOCK, 0o600); } catch (_) { /* the store is this user's already */ }
    console.log(`Also on ${SOCK}, for the dashboard's container.`);
  });
  process.on('exit', () => { try { fs.unlinkSync(SOCK); } catch (_) { /* gone */ } });
}

server.listen(PORT, process.env.SCREEN_RUNNER_BIND || '0.0.0.0', () => {
  // The port file is how the container finds it without being told.
  fs.writeFileSync(path.join(STORE, '.runner-port'), `${PORT}\n`);
  console.log(`Screen runner on ${process.env.SCREEN_RUNNER_BIND || '0.0.0.0'}:${PORT} — sessions run on ${require('os').hostname()}, not in the container.`);
  console.log(`Token: ${path.join(STORE, '.runner-token')} (the dashboard reads it through the workspace mount)`);
  if (!WebSocketServer) console.log('NOTE: ws was not found, so browser terminals will not attach. Run npm install in core/workspace-app.');
});
