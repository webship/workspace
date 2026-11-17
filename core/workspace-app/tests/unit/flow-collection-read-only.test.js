/**
 * A list or a map written on one line is not a text field (#441).
 *
 * `projects: []` (Jira's allowlist) and `targets: {}` (what Google Drive pushes) were text fields holding `[]` and
 * `{}`; what a person typed there was saved as a string, and the plugin silently ignored it.
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
const FILE = 'site: https://example.invalid\nprojects: []\ntargets: {}\ntags: [a, b]\nkeep:\n  - one\n';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-flow-'));
const config = path.join(root, 'core', 'config');
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
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\n');
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'plugin.x-flow.settings.yml'), FILE);
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

test('a one-line list or map is shown read-only, says what it is and where to edit it, and is not posted', async () => {
  const html = await (await fetch(`${base}/settings/plugin.x-flow.settings.yml`)).text();
  for (const [key, value, kind] of [['projects', '[]', 'list'], ['targets', '{}', 'map'], ['tags', '[a, b]', 'list']]) {
    const at = html.indexOf(`>${key}</label>`);
    assert.ok(at > 0, key);
    const row = html.slice(at, html.indexOf('</div>', html.indexOf('-flow">', at)));
    assert.match(row, new RegExp(`<input class="uk-input settings-readonly" id="(s_\\d+)" value="${value.replace(/[[\]{}]/g, (c) => `\\${c}`)}" readonly aria-describedby="\\1-flow">`), key);
    assert.match(row, new RegExp(`A ${kind}: edit it in the\\s+<a href="/settings/plugin\\.x-flow\\.settings\\.yml\\?raw=1">Raw YAML</a> tab\\.`), key);
    assert.doesNotMatch(row, /name="[kv]_/, `${key} is not posted`);
  }
  // A plain value keeps its field, and a block list keeps its list editor.
  assert.match(html, /name="v_0" value="https:\/\/example\.invalid"/);
  assert.match(html, /id="list-editor-keep"/);
});

test('a save of the form leaves the list and the map as they are', async () => {
  const r = await fetch(`${base}/actions/save-settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true', Origin: base },
    body: new URLSearchParams({ file: 'plugin.x-flow.settings.yml', k_0: 'site', v_0: 'https://other.invalid' }).toString() });
  assert.match(await r.text(), /1 key\(s\) updated: <code>site<\/code>/);
  const text = fs.readFileSync(path.join(config, 'plugin.x-flow.settings.yml'), 'utf8');
  assert.match(text, /^projects: \[\]$/m);
  assert.match(text, /^targets: \{\}$/m);
  assert.match(text, /^tags: \[a, b\]$/m);
});
