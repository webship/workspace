/**
 * `core`, `backups` and `commands` are folders of the workspace, never a workspace.
 *
 * The Settings list of workspaces took any lowercase name, `core` included; the dashboard then served
 * `core/` as a workspace, and /files/core/config/settings.yml answered with every key and token in it.
 * Refused when added, and skipped when a settings.yml lists one by hand.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-reserved-'));
const settings = path.join(root, 'core', 'config', 'settings.yml');
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'backups', 'dev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backups', 'dev', 'dev---site1--2026.tar.gz'), 'x');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('adding core, backups or commands as a workspace is refused, and nothing is written', async () => {
  const before = fs.readFileSync(settings, 'utf8');
  for (const name of ['core', 'backups', 'commands']) {
    const r = await fetch(`${base}/actions/list-add`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ file: 'settings.yml', key: 'workspaces', newEntry: name }) });
    const text = await r.text();
    assert.match(text, new RegExp(`${name} is a folder of the workspace itself, not a workspace`), name);
  }
  assert.strictEqual(fs.readFileSync(settings, 'utf8'), before, 'settings.yml is unchanged');
  assert.ok(!fs.existsSync(path.join(root, 'core', 'config', 'workspace.core.settings.yml')));
});

test('one listed by hand is not served as a workspace', async () => {
  fs.writeFileSync(settings, fs.readFileSync(settings, 'utf8').replace(/^workspaces:\n/m, 'workspaces:\n  - core\n  - backups\n'));
  await new Promise((r) => { setTimeout(r, 2100); });   // the workspace list is kept for two seconds
  for (const p of ['/files/core/config/settings.yml', '/files/backups/dev/dev---site1--2026.tar.gz', '/core', '/fragments/core/items']) {
    const r = await fetch(base + p);
    assert.notStrictEqual(r.status, 200, `${p} answers ${r.status}`);
  }
  const home = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(home, /href="\/core"/, 'no card for it');
});
