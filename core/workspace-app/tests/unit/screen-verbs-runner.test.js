/**
 * Every screen verb on a session on the machine goes through the host runner (webship/workspace#591, for #564).
 *
 * The dashboard's web container shared the machine's process space (`pid: host`) so that screen in it could reach the
 * sessions on the machine: interrupt, detach, typing a line, /exit, kill, wipe, and `ps` for which sessions run Claude
 * Code and which automation browsers are open. DDEV ends a web container with `kill -- -1`, which from there reached
 * the other containers. With the container in a process space of its own, screen in it reaches only its own sessions,
 * so the verbs on a session on the machine go through the runner, as a terminal on one attaches since #558: over its
 * unix socket in .screens/, else through the mailbox. And a session is addressed by its whole name, `<pid>.<name>`:
 * screen's `-S <name>` takes any session whose name starts with it.
 *
 * Against the real runner with a stand-in `screen` and `ps` on its PATH (the machine), the dashboard's routing with
 * another stand-in `screen` and `ps` (its container), and the actions through a real dashboard. Nothing here signals
 * a real process but the children this test started, each by its own pid.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { copyConfig } = require('./_isolated-config');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const until = async (fn, ms = 8000) => { for (let t = 0; t < ms && !(await fn()); t += 100) await wait(100); return fn(); };
/** The runner's answer to a mailbox request, once it is there whole (as the dashboard reads it, jobs.js), or null. */
const answerOf = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-verbs-'));
const store = path.join(root, '.screens');
const machineBin = path.join(root, 'machine-bin');
const hereBin = path.join(root, 'here-bin');
const machineLog = path.join(root, 'machine-screen.log');
const hereLog = path.join(root, 'here-screen.log');

/** A stand-in `screen`: -ls answers what <name>-ls.txt holds; every other call is written down, one per record. */
function standInScreen(dir, name, log) {
  fs.writeFileSync(path.join(dir, 'screen'), `#!/bin/sh
case "$1" in
  --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;;
  -ls) cat ${JSON.stringify(path.join(root, `${name}-ls.txt`))}; exit 1 ;;
esac
for a in "$@"; do printf '%s\\037' "$a" >> ${JSON.stringify(log)}; done
printf '\\036' >> ${JSON.stringify(log)}
[ "$4" = "hardcopy" ] && printf 'user@host:~$ \\n' > "$5"
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'ps'), `#!/bin/sh\ncat ${JSON.stringify(path.join(root, `${name}-ps.txt`))}\n`, { mode: 0o755 });
}

/** The calls a stand-in screen got, as argument lists, without the runner's own hardcopy reads. */
const calls = (log) => {
  let text = '';
  try { text = fs.readFileSync(log, 'utf8'); } catch (_) { return []; }
  return text.split('\x1e').filter(Boolean).map((r) => r.split('\x1f').slice(0, -1)).filter((a) => a[3] !== 'hardcopy');
};
const ls = (name, rows) => fs.writeFileSync(path.join(root, `${name}-ls.txt`), rows.length
  ? `There are screens on:\n${rows.map((r) => `\t${r}\t(today)\t(Detached)`).join('\n')}\n${rows.length} Sockets in /tmp/s.\n`
  : 'No Sockets found in /tmp/s.\n');

let runner;
let token;
const sock = path.join(store, 'runner.sock');

before(async () => {
  fs.mkdirSync(machineBin, { recursive: true });
  fs.mkdirSync(hereBin, { recursive: true });
  standInScreen(machineBin, 'machine', machineLog);
  standInScreen(hereBin, 'here', hereLog);
  // The machine: two sessions, one with Claude Code under it, and a Playwright MCP browser.
  ls('machine', ['5151.dev--x--build', '5153.dev--x--claude']);
  fs.writeFileSync(path.join(root, 'machine-ps.txt'), [
    '    1     0 10:00:00 /sbin/init',
    ' 5151     1 01:00 SCREEN -dmS dev--x--build bash -lc make',
    ' 5160  5151 01:00 bash -lc make',
    ' 5153     1 01:00 SCREEN -dmS dev--x--claude bash -lc exec claude',
    ' 5170  5153 01:00 node /usr/local/bin/claude --session-id 1',
    ' 6000     1 02:00 /opt/google/chrome/chrome --user-data-dir=/home/u/.cache/ms-playwright-mcp/mcp-chrome-1 --remote-debugging-pipe about:blank',
    '',
  ].join('\n'));
  // The dashboard's container: a session of its own, and pid 5151 in its own process space, which is another
  // process here, with Claude Code under it (the assistant's own, say).
  ls('here', ['4242.dev--x--mine']);
  fs.writeFileSync(path.join(root, 'here-ps.txt'), [
    '    1     0 10:00 /sbin/init',
    ' 4242     1 01:00 SCREEN -dmS dev--x--mine bash -l',
    ' 4250  4242 01:00 claude',
    ' 5151     1 01:00 node server.js',
    ' 5152  5151 01:00 claude -p hello',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const rport = await free();
  runner = spawn(process.execPath, [path.join(APP, 'scripts', 'screen-runner.js')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${machineBin}${path.delimiter}${process.env.PATH}`, WORKSPACE_ROOT: root, SCREEN_RUNNER_PORT: String(rport), SCREEN_RUNNER_BIND: '127.0.0.1' } });
  const up = await until(() => {
    try { return fs.statSync(sock).isSocket() && JSON.parse(fs.readFileSync(path.join(store, 'host-sessions.json'), 'utf8')).sessions.length === 2; } catch (_) { return false; }
  }, 10000);
  assert.ok(up, 'the runner is up, on its socket, and has published its list');
  token = fs.readFileSync(path.join(store, '.runner-token'), 'utf8').trim();
  // The dashboard, in this process: the workspace and its container's screen and ps.
  process.env.WORKSPACE_ROOT = root;
  process.env.HOME = root;
  process.env.PATH = `${hereBin}${path.delimiter}${process.env.PATH}`;
});

after(async () => {
  if (runner && runner.exitCode === null && runner.signalCode === null) {
    runner.kill('SIGCONT');
    runner.kill('SIGTERM');
    await until(() => runner.exitCode !== null || runner.signalCode !== null, 5000);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** POST to the runner over its unix socket. */
const ask = (pathname, body, { tok = token } = {}) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body || {});
  const req = http.request({ socketPath: sock, path: pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-runner-token': tok } }, (res) => {
    let out = '';
    res.on('data', (d) => { out += d; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out || '{}') }));
  });
  req.on('error', reject);
  req.end(data);
});

/* ------------------------------------------------------------------ the runner */

test('the runner publishes which sessions run Claude Code, the browsers, and the verbs it does', async () => {
  const pub = JSON.parse(fs.readFileSync(path.join(store, 'host-sessions.json'), 'utf8'));
  const by = Object.fromEntries(pub.sessions.map((s) => [s.session, s]));
  assert.strictEqual(by['dev--x--claude'].agent, true, 'Claude Code under the session, read from the machine\'s process table');
  assert.strictEqual(by['dev--x--build'].agent, false);
  assert.deepStrictEqual(pub.browsers.map((b) => [b.pid, b.profile, b.pipe]), [['6000', 'mcp-chrome-1', true]]);
  for (const v of ['start', 'stop', 'stuff', 'detach', 'wipe']) assert.ok(pub.verbs.includes(v), `it says it does ${v}`);
});

test('over its socket the runner types into a session, detaches it and ends it, each by its whole name', async () => {
  const before = calls(machineLog).length;
  assert.deepStrictEqual((await ask('/stuff', { session: 'dev--x--build', text: '\x03' })).body, { ok: true });
  assert.deepStrictEqual((await ask('/detach', { session: 'dev--x--build' })).body, { ok: true });
  assert.deepStrictEqual((await ask('/stop', { session: 'dev--x--build' })).body, { ok: true });
  assert.deepStrictEqual(calls(machineLog).slice(before), [
    ['-S', '5151.dev--x--build', '-X', 'stuff', '\x03'],
    ['-S', '5151.dev--x--build', '-X', 'detach'],
    ['-S', '5151.dev--x--build', '-X', 'quit'],
  ]);
});

test('a verb on a session that is gone never reaches one whose name starts alike', async () => {
  ls('machine', ['5155.dev--x--build-2']);
  try {
    const before = calls(machineLog).length;
    const r = await ask('/stop', { session: 'dev--x--build' });
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.gone, true);
    assert.deepStrictEqual(calls(machineLog).slice(before), [], 'screen -S dev--x--build would have quit dev--x--build-2');
  } finally {
    ls('machine', ['5151.dev--x--build', '5153.dev--x--claude']);
  }
});

test('the runner wipes, refuses a bad name or too much text, and a wrong token', async () => {
  const before = calls(machineLog).length;
  assert.deepStrictEqual((await ask('/wipe', {})).body, { ok: true });
  assert.deepStrictEqual(calls(machineLog).slice(before), [['-wipe']]);
  assert.strictEqual((await ask('/stuff', { session: 'bad name; rm', text: 'x' })).status, 400);
  assert.strictEqual((await ask('/stuff', { session: 'dev--x--build', text: '' })).status, 400);
  assert.strictEqual((await ask('/stuff', { session: 'dev--x--build', text: 'x'.repeat(5000) })).status, 400);
  assert.strictEqual((await ask('/detach', { session: 'dev--x--build' }, { tok: 'wrong' })).status, 403);
  assert.strictEqual(calls(machineLog).length, before + 1, 'none of those reached screen');
});

test('the mailbox takes the same verbs, for a dashboard that cannot reach the socket', async () => {
  const before = calls(machineLog).length;
  const id = `t${Date.now()}`;
  // Written beside and renamed in, as the dashboard writes it (jobs.js): written in place, the folder watch can
  // fire before the content is there (#631).
  const tmp = path.join(store, 'queue', `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify({ id, action: 'detach', session: 'dev--x--claude' }));
  fs.renameSync(tmp, path.join(store, 'queue', `${id}.json`));
  const result = path.join(store, 'results', `${id}.json`);
  assert.ok(await until(() => answerOf(result)), 'answered');
  assert.deepStrictEqual(answerOf(result), { ok: true });
  fs.unlinkSync(result);
  assert.deepStrictEqual(calls(machineLog).slice(before), [['-S', '5153.dev--x--claude', '-X', 'detach']]);
});

test('a request the runner finds still empty is put back and answered once it is written, not dropped (#631)', async () => {
  const before = calls(machineLog).length;
  const id = `t${Date.now()}e`;
  // A writer that writes in place: the file is there, empty, for longer than a drain takes to find it.
  const fd = fs.openSync(path.join(store, 'queue', `${id}.json`), 'w');
  await wait(1200);
  fs.writeSync(fd, JSON.stringify({ id, action: 'detach', session: 'dev--x--claude' }));
  fs.closeSync(fd);
  const result = path.join(store, 'results', `${id}.json`);
  assert.ok(await until(() => answerOf(result)), 'answered');
  assert.deepStrictEqual(answerOf(result), { ok: true });
  fs.unlinkSync(result);
  assert.deepStrictEqual(calls(machineLog).slice(before), [['-S', '5153.dev--x--claude', '-X', 'detach']]);
  // One that stays unreadable is not kept for ever: made old beside the queue, then renamed in.
  const junk = path.join(store, 'queue', `${id}j.json`);
  const old = path.join(store, 'queue', `.${id}j.tmp`);
  fs.writeFileSync(old, '{ not json');
  fs.utimesSync(old, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
  fs.renameSync(old, junk);
  assert.ok(await until(() => !fs.existsSync(junk) && !fs.existsSync(`${junk}.taken`)), 'an old unreadable request is taken away');
});

/* ------------------------------------------------------------------ the dashboard's routing */

test('a session screen here lists is reached here; one only the runner lists, through the runner', async () => {
  const { screenVerb } = require('../../screen-verbs');
  const machineBefore = calls(machineLog).length;
  const hereBefore = calls(hereLog).length;
  assert.strictEqual((await screenVerb('dev--x--mine', 'stuff', { text: 'echo hi\n' })).ok, true);
  assert.strictEqual((await screenVerb('dev--x--build', 'detach')).ok, true);
  assert.strictEqual((await screenVerb('dev--x--claude', 'stuff', { text: '/exit' })).ok, true);
  assert.deepStrictEqual(calls(hereLog).slice(hereBefore), [['-S', '4242.dev--x--mine', '-X', 'stuff', 'echo hi\n']],
    'only its own session reached screen here, by its whole name');
  assert.deepStrictEqual(calls(machineLog).slice(machineBefore), [
    ['-S', '5151.dev--x--build', '-X', 'detach'],
    ['-S', '5153.dev--x--claude', '-X', 'stuff', '/exit'],
  ], 'the machine\'s sessions went to the runner');
});

test('no session of that name: said, and nothing is asked of screen anywhere', async () => {
  const { screenVerb } = require('../../screen-verbs');
  const before = calls(machineLog).length + calls(hereLog).length;
  const out = await screenVerb('dev--x--nothing', 'stop');
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.gone, true);
  assert.strictEqual(calls(machineLog).length + calls(hereLog).length, before);
});

test('a runner that stopped refreshing its list cannot be reached, and one from an older release does not stuff', async () => {
  const { screenVerb } = require('../../screen-verbs');
  const file = path.join(store, 'host-sessions.json');
  // Stopped: its list is old. The session is on the machine, and screen here cannot reach it.
  runner.kill('SIGSTOP');
  try {
    const pub = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...pub, at: Date.now() - 60000 }));
    const before = calls(hereLog).length;
    const out = await screenVerb('dev--x--build', 'detach');
    assert.strictEqual(out.runnerDown, true);
    assert.strictEqual(calls(hereLog).length, before, 'screen here was not tried on a session it cannot see');
    // An older runner: a fresh list without the verbs.
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), sessions: pub.sessions }));
    const old = await screenVerb('dev--x--build', 'stuff', { text: '\x03' });
    assert.strictEqual(old.runnerOld, true);
  } finally {
    runner.kill('SIGCONT');
    await until(() => { try { return Array.isArray(JSON.parse(fs.readFileSync(file, 'utf8')).verbs); } catch (_) { return false; } });
  }
});

test('the agent of a session on the machine is the runner\'s answer, never a walk of this process space', async () => {
  const screens = require('../../screens');
  const rows = await screens.listScreens();
  const by = Object.fromEntries(rows.map((s) => [s.session, s]));
  assert.strictEqual(by['dev--x--mine'].via, 'here');
  assert.strictEqual(by['dev--x--build'].via, 'runner');
  const agents = screens.agentSessions(rows);
  assert.ok(agents.has('dev--x--claude'), 'the runner read it from the machine');
  assert.ok(agents.has('dev--x--mine'), 'its own session is walked here');
  assert.ok(!agents.has('dev--x--build'), 'pid 5151 here is another process, whose Claude Code is not that session\'s');
});

test('the browsers listed are the machine\'s, as the runner read them', async () => {
  const screens = require('../../screens');
  const browsers = await screens.listPlaywrightBrowsers();
  assert.deepStrictEqual(browsers.map((b) => b.profile), ['mcp-chrome-1']);
});

test('a followed log goes on while screen here or the runner lists the session, and ends once neither does', () => {
  const alive = (s) => spawnSync(process.execPath, [path.join(APP, 'scripts', 'session-alive.js'), s, root],
    { env: { ...process.env, PATH: `${hereBin}${path.delimiter}${process.env.PATH}` } }).status;
  assert.strictEqual(alive('dev--x--build'), 0, 'the runner lists it');
  assert.strictEqual(alive('dev--x--mine'), 0, 'screen here lists it');
  assert.strictEqual(alive('dev--x--buil'), 1, 'never a name that merely starts alike');
  assert.strictEqual(alive('dev--x--nothing'), 1);
  assert.strictEqual(alive('bad name'), 2);
});

/* ------------------------------------------------------------------ the actions, through a real dashboard */

test('the Screens page\'s verbs on a session on the machine go to the runner, and say so when it is away', async () => {
  const port = await free();
  const dash = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${hereBin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root,
      WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 20000);
      dash.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
      dash.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
    });
    const post = async (p, form) => {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
      return { status: r.status, text: await r.text() };
    };
    const machineBefore = calls(machineLog).length;
    const hereBefore = calls(hereLog).length;
    let r = await post('/actions/screen-interrupt', { session: 'dev--x--build' });
    assert.strictEqual(r.status, 200, r.text);
    assert.match(r.text, /Sent Ctrl-C to <strong>dev--x--build<\/strong>/);
    r = await post('/actions/screen-detach', { session: 'dev--x--build' });
    assert.match(r.text, /Detached every other client from <strong>dev--x--build<\/strong>/);
    r = await post('/actions/screen-reset-modes', { session: 'dev--x--build', confirm: 'yes' });
    assert.match(r.text, /Cleared the mouse and paste modes/);
    r = await post('/actions/screen-stop', { session: 'dev--x--build', confirm: 'yes' });
    assert.strictEqual(r.status, 200, r.text);
    r = await post('/actions/screen-wipe', {});
    assert.strictEqual(r.status, 200);
    const machine = calls(machineLog).slice(machineBefore);
    assert.deepStrictEqual(machine.slice(0, 2), [['-S', '5151.dev--x--build', '-X', 'stuff', '\x03'], ['-S', '5151.dev--x--build', '-X', 'detach']]);
    assert.match(machine[2].join(' '), /^-S 5151\.dev--x--build -X stuff printf "\\\\033\[\?1000l/, 'the mode reset is typed there too');
    assert.deepStrictEqual(machine.slice(3), [['-S', '5151.dev--x--build', '-X', 'quit'], ['-wipe']]);
    assert.deepStrictEqual(calls(hereLog).slice(hereBefore), [['-wipe']], 'screen here only wiped its own');
    // The runner away: its list is old, and the page says what to do instead of reaching for screen here.
    runner.kill('SIGSTOP');
    try {
      const file = path.join(store, 'host-sessions.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), at: Date.now() - 60000 }));
      r = await post('/actions/screen-interrupt', { session: 'dev--x--build' });
      assert.strictEqual(r.status, 503);
      assert.match(r.text, /its runner is not up\. Start it once with: <code>bash ~\/workspace\/core\/workspace-app\/scripts\/screen-host\.sh --start<\/code>/);
      r = await post('/actions/screen-stop', { session: 'dev--x--build', confirm: 'yes' });
      assert.strictEqual(r.status, 503, 'a kill that cannot reach the session does not say it stopped');
    } finally {
      runner.kill('SIGCONT');
    }
  } finally {
    dash.kill('SIGTERM');
    await until(() => dash.exitCode !== null || dash.signalCode !== null, 5000);
  }
});

test('the runner writes an answer beside the results and renames it in, so a reader never finds half of one (#657)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'screen-runner.js'), 'utf8');
  const fn = src.slice(src.indexOf('function answer(id, body) {'), src.indexOf('\n}\n', src.indexOf('function answer(id, body) {')) + 2);
  assert.match(fn, /fs\.writeFileSync\(tmp, JSON\.stringify\(body\)\); fs\.renameSync\(tmp, file\);/);
  assert.doesNotMatch(fn, /writeFileSync\(path\.join\(RESULTS/, 'never written in place');
});
