/**
 * A secret that still holds the placeholder is not presented as set (#439).
 *
 * The form's box said "set — leave blank to keep it" under the row's own "Still the placeholder: replace it",
 * and the raw editor masked CHANGE_ME like a real secret, so the placeholder could not be seen there at all.
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
const FILE = 'cli_token: CHANGE_ME\napi_secret: "CHANGE_ME"\nrefresh_token: ""\ntoken: r9-not-a-real-token\n';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-placeholder-secret-'));
process.env.WORKSPACE_CONFIG = TMP;
const { readSettingsText, SECRET_MASK } = require('../../settings-file');

test('the raw editor shows a placeholder as it is and masks only a real value', () => {
  fs.writeFileSync(path.join(TMP, 'plugin.x-secret.settings.yml'), FILE);
  const raw = readSettingsText('plugin.x-secret.settings.yml');
  assert.match(raw.text, /^cli_token: CHANGE_ME$/m);
  assert.match(raw.text, /^api_secret: "CHANGE_ME"$/m);
  assert.match(raw.text, /^refresh_token: ""$/m);
  assert.match(raw.text, new RegExp(`^token: ${SECRET_MASK.replace(/[<>]/g, (c) => `\\${c}`)}$`, 'm'));
  assert.ok(!raw.text.includes('r9-not-a-real-token'));
  assert.deepStrictEqual(raw.masked, ['token']);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-placeholder-form-'));
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
  fs.writeFileSync(path.join(config, 'plugin.x-secret.settings.yml'), FILE);
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
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('the form: a placeholder secret is "not set — still the placeholder", a real one "set — leave blank to keep it"', async () => {
  const html = await (await fetch(`${base}/settings/plugin.x-secret.settings.yml`)).text();
  const box = (key) => {
    const at = html.indexOf(`value="${key}"`);
    assert.ok(at > 0, key);
    return (html.slice(html.lastIndexOf('<input class="uk-input"', at), at).match(/placeholder="([^"]*)"/) || [])[1];
  };
  assert.strictEqual(box('cli_token'), 'not set — still the placeholder');
  assert.strictEqual(box('api_secret'), 'not set — still the placeholder');
  assert.strictEqual(box('refresh_token'), 'not set');
  assert.strictEqual(box('token'), 'set — leave blank to keep it');
  assert.ok(!html.includes('r9-not-a-real-token'), 'the real one never reaches the page');
});
