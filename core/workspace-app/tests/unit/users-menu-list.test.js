/**
 * The test users of a project come from a list it has, or are not offered (webship/workspace#490).
 *
 * The Tests menu's "Add the test users" handed a project that is not Drupal and that no plugin claims the Webship
 * distribution's list, which runs drush: on a CodeIgniter app, and on a Node app (Strapi) where it ran
 * `ddev composer require drush/drush`. Against a real server over a temp workspace with a stand-in `screen` that
 * writes down what it was asked to start.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-users-list-'));
const asked = path.join(root, 'asked.txt');
let proc;
let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const project = (name, type) => {
  const dir = path.join(root, 'dev', name);
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), `name: ${name}\ntype: ${type}\ndocroot: web\n`);
};

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  for (const f of ['row-actions.yml', 'row-actions.seen.json']) fs.rmSync(path.join(root, 'core/config', f), { force: true });
  project('drupal-site', 'drupal11');
  project('node-app', 'generic');
  project('php-app', 'php');
  for (const f of ['cmd-tools-testing.sh', 'cmd-tools-add-users.sh', 'cmd-tools-cancel-users.sh']) fs.writeFileSync(path.join(root, 'dev', f), '#!/usr/bin/env bash\n', { mode: 0o755 });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh\ncase "$1" in --version) echo "Screen version 4.09.01"; exit 0 ;; -ls) exit 1 ;; esac\nprintf '%s\\n' "$*" >> ${JSON.stringify(asked)}\nexit 0\n`, { mode: 0o755 });
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' } });
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

const menu = async (p) => (await fetch(`${base}/fragments/row-menu/tests/dev/${p}`)).text();
const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return { status: r.status, text: await r.text() };
};
const started = () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8') : '');

test('a Drupal project is offered its test users, and the list handed over is Drupal core\'s', async () => {
  assert.match(await menu('drupal-site'), /hx-post="\/actions\/add-users"/);
  const r = await post('/actions/add-users', { workspace: 'dev', projectName: 'drupal-site' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(started(), /'cmd-tools-add-users\.sh' 'drupal-site' 'drupal'/);
});

test('an app that is not Drupal and that no plugin claims is offered none, and the verb starts nothing', async () => {
  for (const p of ['node-app', 'php-app']) {
    const html = await menu(p);
    assert.ok(!html.includes('/actions/add-users') && !html.includes('/actions/cancel-users'), `${p}: no test users in its Tests menu`);
    assert.match(html, /Set up the testing environment/, `${p}: the rest of the menu is still there`);
    const before = started();
    for (const verb of ['/actions/add-users', '/actions/cancel-users']) {
      const r = await post(verb, { workspace: 'dev', projectName: p });
      assert.strictEqual(r.status, 409, r.text);
      assert.match(r.text, new RegExp(`${p} has no list of test users: it is not a Drupal project, and no installed plugin claims it`));
    }
    assert.strictEqual(started(), before, `${p}: nothing was started, least of all the Webship list`);
  }
});
