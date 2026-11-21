/**
 * Settings → General shows the plugins as one block of lines, managed on their own page (webship/workspace#661).
 *
 * Each added plugin was a `plugins.<name>` box of raw keys: `module`, an editable text field holding the npm package
 * the dashboard loads the plugin by, and `enabled`, a switch that skipped what Activate and Deactivate do. Now each is
 * one line, its name as its manifest labels it, whether it is on, its package and Manage; none of it is a form field.
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
const SETTINGS = `account:
  name: webmaster
workspaces:
  - dev
plugins:
  upsun:
    module: '@webship.co/workspace-upsun'
    enabled: true
  jira:
    module: '@webship.co/workspace-jira'
    enabled: false
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-general-plugins-'));
const config = path.join(root, 'core', 'config');
const file = path.join(config, 'settings.yml');
let proc;
let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(config, { recursive: true });
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.writeFileSync(file, SETTINGS);
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  for (const [name, label] of [['upsun', 'Upsun'], ['jira', 'Jira']]) {
    fs.mkdirSync(path.join(root, 'plugins', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', name, 'package.json'), JSON.stringify({ name: `@webship.co/workspace-${name}`, version: '1.0.9', workspacePlugin: { name, label } }));
  }
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: path.join(root, 'plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1' } });
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

test('one plugins block: each plugin\'s name, whether it is on, its package and where it is managed; no field of it is posted', async () => {
  const html = await (await fetch(`${base}/settings/settings.yml`)).text();
  const block = html.slice(html.indexOf('<fieldset class="settings-group settings-plugins">'), html.indexOf('</fieldset>', html.indexOf('settings-plugins">')));
  assert.ok(block.length > 100, 'the plugins block');
  const line = (label) => block.slice(block.indexOf(`<span class="settings-plugin-name">${label}</span>`)).split('</li>')[0];
  // Each line is a settings row too, so the file's filter finds a plugin by its name or package.
  assert.strictEqual((block.match(/<li class="settings-row settings-plugin-line">/g) || []).length, 2);
  assert.match(line('Upsun'), /<span class="uk-label uk-label-success">On<\/span>/);
  assert.match(line('Upsun'), /<code class="settings-plugin-module">@webship\.co\/workspace-upsun<\/code>/);
  assert.match(line('Upsun'), /<a class="settings-plugin-manage" href="\/settings\/plugins\/upsun">Manage<span class="uk-hidden-visually"> Upsun<\/span><\/a>/);
  assert.match(line('Jira'), /<span class="uk-text-meta settings-plugin-state">Off<\/span>/);
  // No box per plugin, and no form field for any line of plugins: (lines 5 to 11 of the file).
  assert.doesNotMatch(html, /<legend class="settings-group-name">plugins\.upsun<\/legend>/);
  for (let l = 5; l <= 11; l += 1) assert.doesNotMatch(html, new RegExp(`name="[kv]_${l}"`), `line ${l} is not posted`);
  // The rest of General is as it was.
  assert.match(html, /name="v_1" value="webmaster"/);
});

test('a save of General leaves the plugins as they are', async () => {
  const r = await fetch(`${base}/actions/save-settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: base },
    body: new URLSearchParams({ file: 'settings.yml', k_1: 'name', v_1: 'someone' }).toString() });
  assert.strictEqual(r.status, 200, await r.text());
  assert.strictEqual(fs.readFileSync(file, 'utf8'), SETTINGS.replace('name: webmaster', 'name: someone'));
});
