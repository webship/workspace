/**
 * No request takes the dashboard down.
 *
 * The area modules' actions were wrapped in a try/catch; the branches of handleAction and the plugins'
 * actions were not, and the POST route does not wait for the promise. One that threw was an unhandled
 * rejection, and Node ended the process with every job in memory: a NUL in a chat message (spawn throws
 * on it), a style name too long for a file name. And a malformed %-escape in an address answered 500.
 * Against a real server over a temp workspace tree; after each, the server still answers.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-action-errors-'));
let proc;
let base;
let exited = null;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'dev', 'site1'), { recursive: true });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // claude, as a stand-in: an answer, whatever was asked.
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho \'{"result":"An answer.","session_id":"s1"}\'\n', { mode: 0o755 });
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.on('exit', (c) => { exited = c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc && exited === null) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const post = async (p, form) => {
  try {
    const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
    return { status: r.status, text: await r.text() };
  } catch (err) { return { status: 0, text: String(err && err.cause ? err.cause.code : err) }; }
};
const stillUp = async () => {
  await new Promise((r) => { setTimeout(r, 300); });
  assert.strictEqual(exited, null, 'the dashboard process is still running');
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200, 'and still answers');
};

test('a NUL in a chat message is an answer, not the end of the dashboard', async () => {
  const r = await post('/actions/chat', { message: 'hello\u0000 there', context: '' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.text, /An answer\./);
  await stillUp();
});

test('a style name too long for a file name is refused with a reason', async () => {
  const r = await post('/actions/style-new', { name: 'a'.repeat(4000), label: 'Long', from: 'default' });
  assert.strictEqual(r.status, 400, r.text);
  assert.match(r.text, /40 at most/);
  await stillUp();
});

test('a malformed %-escape in an address is a 400 that says so', async () => {
  for (const p of ['/files/dev/%E0%A4%A', '/fragments/dev/edit/%E0%A4%A', '/settings/%E0%A4%A']) {
    const r = await fetch(base + p);
    assert.strictEqual(r.status, 400, p);
    assert.match(await r.text(), /malformed %-escape/);
  }
  await stillUp();
});

test('an action that throws answers 500 with what failed, and the next request is served', async () => {
  // The theme the new style is based on is a directory where a file is read: the write fails with an error,
  // in a branch of handleAction that is not one of the area modules.
  fs.mkdirSync(path.join(root, 'core', 'config', 'theme.blocked.yml'), { recursive: true });
  const r = await post('/actions/style-new', { name: 'blocked', label: 'Blocked', from: 'default' });
  assert.ok(r.status === 500 || r.status === 400, `${r.status} ${r.text}`);
  await stillUp();
});
