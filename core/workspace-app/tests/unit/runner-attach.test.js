/**
 * A terminal on a session the host runner started attaches through the runner.
 *
 * The dashboard attached every terminal with `screen -A -x` where it runs. In its container that reaches a session on
 * the machine only when both share screen's socket directory and the machine's processes; when they do not, Open
 * terminal said "There is no screen to be attached matching <session>" twice. Now a session that screen here does
 * not list, and the runner does, is attached by the runner and relayed, over the runner's unix socket in .screens/.
 * Run against the real dashboard with a stand-in runner, and against the real runner with a stand-in `screen`.
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
const hasScript = spawnSync('script', ['--version']).status === 0;
const WebSocket = require('ws');

const { attachesThroughRunner, attachUrl } = require('../../runner-attach');

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms && !fn(); t += 50) await wait(50); return fn(); };

test('through the runner only when screen here does not list the session and the runner does', () => {
  const published = { at: Date.now(), sessions: [{ session: 'dev--a--far' }, { session: 'dev--a--both' }] };
  const ownRows = [{ session: 'dev--a--near' }, { session: 'dev--a--both' }];
  assert.strictEqual(attachesThroughRunner('dev--a--far', { ownRows, published }), true);
  assert.strictEqual(attachesThroughRunner('dev--a--near', { ownRows, published }), false, 'one screen here lists is attached here');
  assert.strictEqual(attachesThroughRunner('dev--a--both', { ownRows, published }), false, 'and so is one both list');
  assert.strictEqual(attachesThroughRunner('dev--a--far', { ownRows, published: null }), false, 'no runner, nothing to relay to');
  assert.strictEqual(attachesThroughRunner('dev--a--none', { ownRows, published }), false);
});

test('the runner is reached over its unix socket when it left one, else its port, with its token', () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-attach-url-'));
  const runner = { token: 't0k', port: 7681, base: 'http://host.docker.internal:7681' };
  try {
    assert.strictEqual(attachUrl(store, runner, 'dev--a--far', { cols: 100, rows: 30 }),
      'ws://host.docker.internal:7681/attach/dev--a--far?token=t0k&cols=100&rows=30');
    fs.writeFileSync(path.join(store, 'runner.sock'), '');
    assert.match(attachUrl(store, runner, 'dev--a--far', { cols: 100, rows: 30 }), /^ws:\/\/host\.docker\.internal/, 'a plain file is not a socket');
    fs.unlinkSync(path.join(store, 'runner.sock'));
    const s = net.createServer().listen(path.join(store, 'runner.sock'));
    return new Promise((resolve) => s.on('listening', () => {
      assert.strictEqual(attachUrl(store, runner, 'dev--a--far', { cols: 100, rows: 30 }),
        `ws+unix:${path.join(store, 'runner.sock')}:/attach/dev--a--far?token=t0k&cols=100&rows=30`);
      s.close(resolve);
    }));
  } finally {
    setTimeout(() => fs.rmSync(store, { recursive: true, force: true }), 200);
  }
});

/* ------------------------------------------------------------------ the dashboard, and a stand-in runner */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-attach-'));
const store = path.join(root, '.screens');
const nearTyped = path.join(root, 'near.txt');
const localAttaches = path.join(root, 'local-attaches.txt');
const TOKEN = 'a-token-only-this-test-knows';
let dashboard;
let port;
let fakeRunner;
const runnerGot = [];
const runnerAsked = [];
let runnerSockets = [];

before(async () => {
  if (!hasScript) return;
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(store, { recursive: true });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // screen here lists `near` only, and attaches it by writing down what reaches it.
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in
  --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;;
  -ls) printf 'There is a screen on:\\n\\t4242.dev--site--near\\t(today)\\t(Detached)\\n1 Socket in ${root}/s.\\n'; exit 1 ;;
  -A) echo "$3" >> ${JSON.stringify(localAttaches)}; stty raw -echo 2>/dev/null; exec cat > ${JSON.stringify(nearTyped)} ;;
esac
exit 0
`, { mode: 0o755 });
  // The runner: its token, its port, its published list (fresh, with `far`), and its unix socket.
  fs.writeFileSync(path.join(store, '.runner-token'), `${TOKEN}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(store, '.runner-port'), '1\n');
  const wss = new WebSocket.WebSocketServer({ noServer: true });
  fakeRunner = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  fakeRunner.on('upgrade', (req, socket, head) => {
    runnerAsked.push(req.url);
    const u = new URL(req.url, 'http://x');
    if (!/^\/attach\/dev--site--far$/.test(u.pathname) || u.searchParams.get('token') !== TOKEN) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      runnerSockets.push(ws);
      ws.send(Buffer.from('hello from the machine'));
      ws.on('message', (d, isBinary) => runnerGot.push({ d: String(d), isBinary }));
    });
  });
  await new Promise((resolve) => fakeRunner.listen(path.join(store, 'runner.sock'), resolve));
  port = await free();
  dashboard = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root,
      WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    dashboard.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    dashboard.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (dashboard) dashboard.kill();
  if (fakeRunner) fakeRunner.close();
  spawnSync('pkill', ['-f', `cat > ${nearTyped}`]);
  fs.rmSync(root, { recursive: true, force: true });
});

const publish = () => fs.writeFileSync(path.join(store, 'host-sessions.json'),
  JSON.stringify({ at: Date.now(), sessions: [{ pid: '5151', session: 'dev--site--far', started: 'today', state: 'Detached' }] }));
const open = (session) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/screen/${session}?cols=100&rows=30`);
  const got = [];
  ws.on('message', (d, isBinary) => got.push({ d: String(d), isBinary }));
  ws.on('open', () => resolve({ ws, got }));
  ws.on('error', reject);
});

test('a session only the runner lists is attached through it, both ways, and the keepalive stays here', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  publish();
  const { ws, got } = await open('dev--site--far');
  assert.ok(await until(() => got.some((m) => m.d === 'hello from the machine')), 'what the runner\'s attach prints reaches the window');
  assert.match(runnerAsked[runnerAsked.length - 1], /^\/attach\/dev--site--far\?token=a-token-only-this-test-knows&cols=100&rows=30$/);
  ws.send('abc');
  ws.send(Buffer.alloc(0), { binary: true });
  assert.ok(await until(() => runnerGot.some((m) => m.d === 'abc')), 'what is typed reaches the runner');
  assert.ok(await until(() => got.some((m) => m.isBinary && m.d === '')), 'the keepalive is answered');
  await wait(200);
  assert.ok(!runnerGot.some((m) => m.d === ''), 'and never sent on to the session');
  // The runner ends the attach cleanly (the session ended): the window is closed cleanly too.
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  runnerSockets[runnerSockets.length - 1].close(1000);
  assert.ok([1000, 1005].includes(await closed));
});

test('a runner that goes away drops the window, so it attaches itself again when the runner is back', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  publish();
  const { ws, got } = await open('dev--site--far');
  assert.ok(await until(() => got.some((m) => m.d === 'hello from the machine')));
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  runnerSockets[runnerSockets.length - 1].close(1001, 'the runner is stopping');
  assert.strictEqual(await closed, 1006, 'not a clean close, which the window would take for the end of the attach');
});

test('a session only the runner can reach is not attached here while the runner does not answer', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  publish();
  const sock = path.join(store, 'runner.sock');
  fs.renameSync(sock, `${sock}.away`);
  try {
    const before = fs.existsSync(localAttaches) ? fs.readFileSync(localAttaches, 'utf8') : '';
    const { ws } = await open('dev--site--far');
    const code = await new Promise((resolve) => ws.on('close', (c) => resolve(c)));
    assert.strictEqual(code, 1006, 'dropped, to be tried again, rather than "There is no screen to be attached"');
    const after = fs.existsSync(localAttaches) ? fs.readFileSync(localAttaches, 'utf8') : '';
    assert.strictEqual(after, before, 'screen here was not asked to attach it');
  } finally {
    fs.renameSync(`${sock}.away`, sock);
  }
});

test('a session screen here lists is attached here, and the runner is not asked', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  publish();
  const asked = runnerAsked.length;
  const { ws } = await open('dev--site--near');
  assert.ok(await until(() => fs.existsSync(nearTyped)), 'attached here');
  ws.send('xyz');
  assert.ok(await until(() => fs.readFileSync(nearTyped, 'utf8') === 'xyz'));
  assert.strictEqual(runnerAsked.length, asked);
  ws.close(1000);
});

test('with no runner up, a session is attached here as before', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  fs.writeFileSync(path.join(store, 'host-sessions.json'), JSON.stringify({ at: Date.now() - 60000, sessions: [{ session: 'dev--site--far' }] }));
  const asked = runnerAsked.length;
  const { ws, got } = await open('dev--site--far');
  await wait(600);
  assert.strictEqual(runnerAsked.length, asked, 'a runner whose list is stale is not up');
  assert.ok(!got.some((m) => m.d === 'hello from the machine'));
  ws.close(1000);
});

/* ------------------------------------------------------------------ the runner itself */

test('the runner listens on its unix socket, this user only, and attaches over it with -A', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runner-'));
  const typed = path.join(r2, 'typed.txt');
  const bin = path.join(r2, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in
  -ls) printf 'There is a screen on:\\n\\t5151.dev--x--host\\t(today)\\t(Detached)\\n1 Socket in ${r2}/s.\\n'; exit 1 ;;
  -A) stty raw -echo 2>/dev/null; exec cat > ${JSON.stringify(typed)} ;;
esac
exit 0
`, { mode: 0o755 });
  const rport = await free();
  const runner = spawn(process.execPath, [path.join(APP, 'scripts', 'screen-runner.js')], { cwd: r2, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, WORKSPACE_ROOT: r2, SCREEN_RUNNER_PORT: String(rport), SCREEN_RUNNER_BIND: '127.0.0.1' } });
  const sock = path.join(r2, '.screens', 'runner.sock');
  try {
    assert.ok(await until(() => { try { return fs.statSync(sock).isSocket(); } catch (_) { return false; } }, 8000), 'the socket is there');
    await wait(100);
    assert.strictEqual(fs.statSync(sock).mode & 0o777, 0o600);
    const token = fs.readFileSync(path.join(r2, '.screens', '.runner-token'), 'utf8').trim();
    const refused = await new Promise((resolve) => {
      const w = new WebSocket(`ws+unix:${sock}:/attach/dev--x--host?token=wrong`);
      w.on('open', () => resolve(false));
      w.on('error', () => resolve(true));
    });
    assert.ok(refused, 'a wrong token is refused on the socket too');
    const w = new WebSocket(`ws+unix:${sock}:/attach/dev--x--host?token=${encodeURIComponent(token)}&cols=90&rows=30`);
    await new Promise((resolve, reject) => { w.on('open', resolve); w.on('error', reject); });
    assert.ok(await until(() => fs.existsSync(typed)), 'attached with screen -A -x');
    w.send(Buffer.alloc(0), { binary: true });
    w.send('abc');
    assert.ok(await until(() => fs.readFileSync(typed, 'utf8') === 'abc'), 'what is typed arrives, and a keepalive does not');
    w.close(1000);
    assert.ok(await until(() => spawnSync('pgrep', ['-f', `cat > ${typed}`]).status !== 0), 'and the whole attach ends with the window');
    // A runner that stops says it is going away, so the dashboard's windows attach again when it is back.
    const w2 = new WebSocket(`ws+unix:${sock}:/attach/dev--x--host?token=${encodeURIComponent(token)}&cols=90&rows=30`);
    await new Promise((resolve, reject) => { w2.on('open', resolve); w2.on('error', reject); });
    const going = new Promise((resolve) => w2.on('close', (code) => resolve(code)));
    runner.kill('SIGTERM');
    assert.strictEqual(await going, 1001);
  } finally {
    runner.kill('SIGTERM');
    await until(() => runner.exitCode !== null || runner.signalCode !== null);
    assert.ok(!fs.existsSync(sock), 'the socket goes with the runner');
    spawnSync('pkill', ['-f', `cat > ${typed}`]);
    fs.rmSync(r2, { recursive: true, force: true });
  }
});
