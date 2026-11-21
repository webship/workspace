/**
 * A setting a plugin's new version dropped is said to do nothing, not shown as live (webship/workspace#424).
 *
 * The screens plugin's `runs.default_mode: page` stayed in a workspace's settings file after the plugin stopped reading
 * it, and Settings showed it as a live field with its old description. The form now compares the file with the template
 * the installed version ships and says which keys it no longer has; the file is left as it is.
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
const { templateShape, droppedKeys } = require('../../plugin-settings-dropped');
const { rowsFromText } = require('../../settings-file');

const TEMPLATE = `# Runs
runs:
  # How long a finished run is kept
  keep_days: 7
# Tokens, one per host
api_tokens: {}
hosts:
extra:
  - one
site: https://example.invalid
`;
const FILE = `# Runs
runs:
  # How a run starts when nobody chose: screen or page
  default_mode: page
  keep_days: 7
api_tokens:
  github: CHANGE_ME
hosts:
  main: example.org
extra:
  - one
site: https://example.invalid
gone: yes
`;

test('the template\'s keys, and the ones it leaves to the person', () => {
  const { keys, open } = templateShape(TEMPLATE);
  assert.deepStrictEqual([...keys].sort(), ['api_tokens', 'extra', 'hosts', 'runs', 'runs.keep_days', 'site']);
  // An empty map on one line, a key with nothing under it, and a list are the person's to fill.
  assert.deepStrictEqual([...open].sort(), ['api_tokens', 'extra', 'hosts']);
});

test('a key the template no longer has is dropped; one under a map the template leaves open is not', () => {
  const dropped = droppedKeys(rowsFromText(FILE), TEMPLATE);
  assert.deepStrictEqual([...dropped].sort(), ['gone', 'runs.default_mode']);
  assert.deepStrictEqual([...droppedKeys(rowsFromText(FILE), '')].sort(), [...new Set(rowsFromText(FILE).map((r) => r.dotted))].sort(),
    'an empty template has none of them');
});

// ---------------------------------------------------------------- the form, from a running dashboard

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-dropped-settings-'));
const config = path.join(root, 'core', 'config');
const userFile = path.join(config, 'plugin.x-old.settings.yml');
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
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces: []\nplugins:\n  x-old:\n    enabled: true\n');
  // The plugin as its new version ships it: a template without runs.default_mode or gone.
  const plugin = path.join(root, 'plugins', 'x-old');
  fs.mkdirSync(path.join(plugin, 'config'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-old', version: '1.0.12',
    workspacePlugin: { name: 'x-old', label: 'Old one', settingsTemplate: 'config/plugin.x-old.settings.yml' } }));
  fs.writeFileSync(path.join(plugin, 'config', 'plugin.x-old.settings.yml'), TEMPLATE);
  // The person's file, written from an older version.
  fs.writeFileSync(userFile, FILE);
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

const NOTE = 'This plugin no longer has this setting: it does nothing now. Delete the line in the Raw YAML tab to tidy the file.';

test('the form says which settings the plugin no longer has, tied to the field, and changes nothing', async () => {
  const html = await (await fetch(`${base}/settings/plugin.x-old.settings.yml`)).text();
  /** The row of a field by its label: from the label to the end of its key block. */
  const row = (label) => { const at = html.indexOf(`>${label}</label>`); assert.ok(at > 0, label); return html.slice(at, html.indexOf('</div>', at)); };
  for (const label of ['default_mode', 'gone']) {
    const r = row(label);
    assert.ok(r.includes(NOTE), `${label}: said to do nothing`);
    // Said first, before the old comment's description, inside what the field's aria-describedby names.
    assert.ok(r.indexOf(NOTE) < (r.indexOf('settings-desc') === -1 ? Infinity : r.indexOf('settings-desc')), `${label}: before its old description`);
    assert.match(html, new RegExp(`aria-describedby="(s_\\d+)-hint[^"]*"[^>]*name="v_\\d+"`));
  }
  for (const label of ['keep_days', 'github', 'main', 'site']) assert.ok(!row(label).includes(NOTE), `${label}: still the plugin's`);
  assert.strictEqual(fs.readFileSync(userFile, 'utf8'), FILE, 'the file is left as it is');
});
