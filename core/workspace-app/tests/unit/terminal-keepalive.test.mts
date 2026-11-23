/**
 * A quiet terminal stays attached.
 *
 * A screen session waiting for an answer prints nothing for minutes, and a proxy drops a websocket that carried
 * nothing for a while (nginx: 60 s by default), so the window froze: nothing typed reached the session and nothing
 * said why. Now the page pings its socket with an empty binary frame the server answers and never types into the
 * session, the server pings too and ends a socket whose browser stopped answering, nginx gives /ws/ a day, and a
 * window whose socket dropped re-attaches by itself and says so. The server half runs against a real server with a
 * `screen` stand-in that writes down what reaches the session.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyConfig } from './_isolated-config.js';

import { isKeepalive, keepAlive, KEEPALIVE_MS, type KeepaliveSocket } from '../../terminal-keepalive.mts';

const APP = path.join(import.meta.dirname, '../..');
const REPO = path.join(APP, '../..');
const read = (f: string): string => fs.readFileSync(path.join(APP, f), 'utf8');
const wait = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** What this test uses of a `ws` client (the package ships no types). */
interface WsClient {
  on(event: 'open' | 'ping', listener: () => void): this;
  on(event: 'close', listener: (code: number) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
  send(data: Buffer | string, opts?: { binary: boolean }): void;
  close(code: number): void;
}
type WsClientClass = new (url: string, opts?: { autoPong?: boolean }) => WsClient;
const WebSocket = createRequire(import.meta.url)('ws') as WsClientClass;

/** A socket as `ws` has it, as far as the keepalive is concerned. */
class FakeSocket extends EventEmitter implements KeepaliveSocket {
  readyState = 1;
  pings = 0;
  terminated = false;
  ping(): void { this.pings += 1; }
  terminate(): void { this.terminated = true; this.readyState = 3; this.emit('close'); }
}
const fakeSocket = (): FakeSocket => new FakeSocket();

test('the keepalive is an empty binary frame, which nothing typed can be', () => {
  assert.strictEqual(isKeepalive(Buffer.alloc(0), true), true);
  assert.strictEqual(isKeepalive(Buffer.alloc(0), false), false, 'an empty text frame is not it');
  assert.strictEqual(isKeepalive(Buffer.from('a'), true), false);
  assert.strictEqual(isKeepalive(Buffer.from('\x03'), false), false, 'Ctrl-C goes through');
  assert.strictEqual(KEEPALIVE_MS, 25000, 'well inside the 60 s a proxy waits by default');
});

test('the server pings on a beat, keeps a socket that answers, and ends one that does not', async () => {
  const answers = fakeSocket();
  keepAlive(answers, { everyMs: 30 });
  answers.on('ping-sent', () => {});
  for (let i = 0; i < 4; i += 1) { await wait(35); answers.emit('pong'); }
  assert.ok(answers.pings >= 3, `pinged on every beat (${answers.pings})`);
  assert.strictEqual(answers.terminated, false);

  const typing = fakeSocket();
  keepAlive(typing, { everyMs: 30 });
  for (let i = 0; i < 4; i += 1) { await wait(35); typing.emit('message', Buffer.from('x'), false); }
  assert.strictEqual(typing.terminated, false, 'a frame from the page is an answer too');

  const gone = fakeSocket();
  keepAlive(gone, { everyMs: 30 });
  await wait(120);
  assert.strictEqual(gone.terminated, true, 'a browser that stopped answering is ended, and its attach with it');
  const pings = gone.pings;
  await wait(80);
  assert.strictEqual(gone.pings, pings, 'and nothing pings it any more');

  const closed = fakeSocket();
  const stop = keepAlive(closed, { everyMs: 30 });
  closed.emit('close');
  await wait(80);
  assert.strictEqual(closed.pings, 0, 'a closed socket is left alone');
  stop();
});

/* ------------------------------------------------------------------ against the real server */

const hasScript = spawnSync('script', ['--version']).status === 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-term-keepalive-'));
const typed = path.join(root, 'typed.txt');
let proc: ChildProcess | undefined;
let port = 0;

const free = (): Promise<number> => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

before(async () => {
  if (!hasScript) return;
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // screen -A -x <session>: a client that writes down every byte that reaches the session.
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;; -ls) exit 1 ;; -A) stty raw -echo 2>/dev/null; exec cat > ${JSON.stringify(typed)} ;; esac
exit 0
`, { mode: 0o755 });
  port = await free();
  const server = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root,
      WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_TERM_KEEPALIVE_MS: '200' } });
  proc = server;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    server.stdout.on('data', (d: Buffer) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  spawnSync('pkill', ['-f', `cat > ${typed}`]);
  fs.rmSync(root, { recursive: true, force: true });
});

const connect = (opts: { autoPong?: boolean } = {}): Promise<WsClient> => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/screen/dev--site1--quiet?cols=100&rows=30`, opts);
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

test('the page\'s keepalive is answered, and never reaches the session', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  const ws = await connect();
  const answers: Buffer[] = [];
  let pings = 0;
  ws.on('message', (d, isBinary) => { if (isBinary && d.length === 0) answers.push(d); });
  ws.on('ping', () => { pings += 1; });
  for (let i = 0; i < 30 && !fs.existsSync(typed); i += 1) await wait(100);
  ws.send(Buffer.alloc(0), { binary: true });
  ws.send(Buffer.alloc(0), { binary: true });
  ws.send('abc');
  for (let i = 0; i < 30 && answers.length < 2; i += 1) await wait(100);
  assert.strictEqual(answers.length, 2, 'each keepalive is answered with an empty binary frame');
  for (let i = 0; i < 30 && fs.readFileSync(typed, 'utf8') !== 'abc'; i += 1) await wait(100);
  assert.strictEqual(fs.readFileSync(typed, 'utf8'), 'abc', 'what was typed arrives, and nothing else');
  await wait(500);
  assert.ok(pings >= 1, `the server pings an open terminal (${pings})`);
  ws.close(1000);
});

test('a browser that stops answering pings is let go', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  const ws = await connect({ autoPong: false });
  const closed = new Promise<number>((resolve) => { ws.on('close', resolve); });
  const t0 = Date.now();
  const code = await Promise.race([closed, wait(5000).then(() => 'still open')]);
  assert.notStrictEqual(code, 'still open', 'ended by the server');
  assert.ok(Date.now() - t0 < 2000, 'within two beats');
});

/* ------------------------------------------------------------------ the page and the proxy */

test('the page pings, judges a socket by its answer, and re-attaches a dropped window', () => {
  // The script as written (src/browser/terminal.ts); public/terminal.js is what esbuild builds from it.
  const page = read('src/browser/terminal.ts');
  assert.match(page, /const KEEPALIVE_MS = 25000;/);
  assert.match(page, /try \{ sock\.send\(new Uint8Array\(0\)\); \} catch \(_\) \{ return; \}/, 'an empty binary frame');
  assert.match(page, /if \(typeof e\.data !== 'string' && e\.data\.byteLength === 0\) \{\n\s+const sock = e\.target as KeptSocket;\n\s+if \(sock\.__answered\) sock\.__answered\(\);\n\s+return;/,
    'the answer is never written into the terminal');
  assert.match(page, /if \(!answers\) return;\n\s+answerTimer = setTimeout\(\(\) => \{/, 'only a socket that answered before is judged by its silence');
  assert.match(page, /const RETRY_MS = \[1000, 2000, 4000, 8000, 15000, 30000\];/);
  assert.match(page, /ws\.onclose = dropped;/);
  assert.match(page, /say\(`connection dropped — re-attaching in \$\{Math\.round\(wait \/ 1000\)\} s…`\);/, 'it says so in the window');
  assert.match(page, /'re-attached after the connection dropped'/);
  assert.match(page, /if \(!live\) return ended\(\);\n\s+if \(!onPurpose\) return retry\(/, 'a session that ended is not attached again');
  assert.match(page, /const onPurpose = !!\(evt && evt\.wasClean\);/, 'nor one the dashboard closed on purpose (a detach)');
  assert.match(page, /\.then\(\(still\) => \(still \? say\('detached — the session keeps running'\) : ended\(\)\)\);/,
    'a session killed a moment ago is asked about once more');
  assert.match(page, /window\.addEventListener\('online', retryNow\);/);
  assert.match(page, /window\.removeEventListener\('online', retryNow\);/, 'and a closed window stops listening');
  assert.match(read('screens.js'), /<span class="term-status uk-text-meta" role="status">connecting…<\/span>/, 'read out as it changes');
  // A narrow window hides its status line, except while the connection is the news.
  assert.match(page, /pane\.dataset\.link = 'dropped';/);
  assert.match(page, /pane\.dataset\.link = 'reattached';/);
  // Said once the session paints into the window again, not when the socket opens: an open socket may still be
  // dropped by a dashboard that finds the host runner away.
  const paint = page.slice(page.indexOf('if (text.length) {'), page.indexOf('term.write(data);'));
  assert.match(paint, /if \(pane\.dataset\.dropped\) \{\n\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+reattachedAt = Date\.now\(\);/);
  assert.match(page, /say\(pane\.dataset\.dropped \? 'connection dropped — re-attaching…' : liveText\(\)\);/);
  assert.match(read('public/css/components/terminals.css'),
    /@container term \(max-width: 32rem\) \{\n  \.term-window \.term-status \{ display: none; \}[\s\S]*?\.term-window\[data-link\] \.term-status \{ display: block; order: 3; flex-basis: 100%; white-space: normal; \}/);
});

test('the dashboard\'s nginx gives the terminals a day, with the upgrade headers', () => {
  const conf = read('.ddev/nginx_full/nginx-site.conf');
  const tier = conf.slice(conf.indexOf('server_name workspace.ddev.site'));
  const ws = tier.slice(tier.indexOf('location /ws/ {'), tier.indexOf('}', tier.indexOf('location /ws/ {')) + 1);
  assert.ok(ws.startsWith('location /ws/ {'), 'the websocket path has its own block in the dashboard\'s server');
  for (const line of ['proxy_pass http://127.0.0.1:3000;', 'proxy_set_header Upgrade $http_upgrade;', 'proxy_set_header Connection $connection_upgrade;',
    'proxy_read_timeout 86400s;', 'proxy_send_timeout 86400s;', 'proxy_buffering off;']) {
    assert.ok(ws.includes(line), line);
  }
  assert.ok(tier.indexOf('location /ws/ {') < tier.indexOf('location / {'), 'before the catch-all, for anyone reading it');
  assert.match(read('server.js'), /termKeepalive\.keepAlive\(ws\);/);
  assert.match(read('server.js'), /if \(termKeepalive\.isKeepalive\(d, isBinary\)\) \{/);
});
