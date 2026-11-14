/**
 * Settings → Plugins on a workspace that has no folder yet.
 *
 * `webship-workspace init` makes an empty workspace, and the Plugins page is where the first plugin is
 * required. Every action used to be refused with "Unknown workspace." unless the form or the host
 * named a workspace folder, falling back to `dev` — which a fresh workspace does not have. The page's
 * buttons belong to the dashboard, not to a folder.
 *
 * Against a real server over an empty tree: no workspaces, no plugins.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-empty-'));
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
  // What init writes: the lean settings, no workspaces, no plugins.
  fs.copyFileSync(path.join(REPO, 'core/config/settings.template.yml'), path.join(root, 'core/config/settings.yml'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_CONFIG: path.join(root, 'core/config'), WORKSPACE_PLUGINS_DIR: path.join(root, 'no-plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return { status: r.status, html: await r.text() };
};

test('the Plugins page answers on a workspace with no folder: its actions are not asked for a workspace', async () => {
  const page = await fetch(`${base}/settings/plugins`);
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /Catalogue/);
  // The action is reached: what it refuses is the plugin or the spec, never the workspace.
  let r = await post('/actions/plugins', { verb: 'activate', name: 'no-such-plugin' });
  assert.strictEqual(r.status, 400);
  assert.match(r.html, /Unknown plugin\./);
  r = await post('/actions/plugins', { verb: 'require', spec: 'not a spec; rm -rf' });
  assert.strictEqual(r.status, 400);
  assert.match(r.html, /That is not a package spec/);
  r = await post('/actions/plugins', { verb: 'explode' });
  assert.match(r.html, /Unknown plugin action\./);
  for (const answer of [r.html]) assert.doesNotMatch(answer, /Unknown workspace/);
  // Stopping a job is the dashboard's too.
  r = await post('/actions/job-stop', { id: 'nope' });
  assert.doesNotMatch(r.html, /Unknown workspace/);
});

test('an action that is about a workspace folder is still refused without one', async () => {
  const r = await post('/actions/ddev-start', { projectName: 'x' });
  assert.strictEqual(r.status, 400);
  assert.match(r.html, /Unknown workspace\./);
});

test('the Require field\'s pattern is one a browser accepts (it is compiled with the v flag)', async () => {
  const html = await (await fetch(`${base}/settings/plugins`)).text();
  const m = html.match(/name="spec"[^>]*pattern="([^"]+)"/);
  assert.ok(m, 'the field has a pattern');
  const re = new RegExp(`^(?:${m[1]})$`, 'v');
  for (const ok of ['@webship.co/workspace-jira', 'github:webship/workspace-upsun#1.0.x', '../plugins/x.tgz', 'git+https://github.com/webship/workspace-dev.git']) assert.ok(re.test(ok), ok);
  assert.ok(!re.test('a b'), 'nothing a shell could read as two words');
});
