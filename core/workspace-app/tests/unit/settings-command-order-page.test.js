/**
 * Command order, one of the five entries of the workspace base, drew the Settings home as its page and the
 * Overview inside its own tab of the Settings modal: the route asked settingsPage for 'build-order', the
 * section's old name, which settingsPage no longer knows, so it fell through to the index.
 *
 * Against a real server over a temp workspace tree.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-command-order-'));
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const text = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };

test('the Command order tab of the Settings modal is the order editor, not the Overview', async () => {
  const { status, html } = await text('/settings/command-order?fragment=1');
  assert.strictEqual(status, 200);
  assert.match(html, /<div id="build-order-editor">/);
  assert.doesNotMatch(html, /class="settings-home/, 'the Settings home drawn under the name Command order');
});

test('the Command order page is the order editor, and keeps its scope', async () => {
  const page = await text('/settings/command-order');
  assert.strictEqual(page.status, 200);
  assert.match(page.html, /<div id="build-order-editor">/);
  assert.doesNotMatch(page.html, /class="settings-home/);
  const scoped = await text('/settings/command-order?scope=dev&fragment=1');
  assert.match(scoped.html, /<div id="build-order-editor">/);
});
