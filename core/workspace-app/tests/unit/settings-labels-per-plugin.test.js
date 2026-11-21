/**
 * A plugin's labels stay on its own settings file (#328).
 *
 * The labels a plugin ships for its keys (the manifest's `labels`, or api.addLabels) were merged into one
 * map keyed by the key alone, so two plugins with the same key shared one label, whichever loaded last:
 * with Azure and Google Drive on, Google Drive's client_id read "Service principal client id"; GoDaddy's
 * api_key read "Acquia API key"; GitLab's and Bitbucket's host, username and token carried GitHub's hints.
 * A plugin's own file is now labelled by that plugin, then by the dashboard's own settings.labels.yml, and
 * never by another plugin. Its lists are labelled the same way, and the list's new-entry field is named.
 *
 * Against a real server over a temporary tree with three folder plugins: x-cloud ships a labels file,
 * x-forge labels its keys from register(api), x-drive ships no labels and shares their key names.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-labels-per-plugin-'));
const config = path.join(root, 'core', 'config');
const plugins = path.join(root, 'plugins');
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function plugin(name, manifest, files = {}) {
  const dir = path.join(plugins, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@example/${name}`, version: '0.0.1', main: 'index.js', workspacePlugin: { name, label: name, ...manifest } }));
  fs.writeFileSync(path.join(dir, 'index.js'), files['index.js'] || 'module.exports.register = () => {};\n');
  for (const [f, text] of Object.entries(files)) if (f !== 'index.js') fs.writeFileSync(path.join(dir, f), text);
}

before(async () => {
  fs.mkdirSync(config, { recursive: true });
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  // The dashboard's own labels, as shipped: the workspaces list is labelled by them.
  fs.copyFileSync(path.join(REPO, 'core/config/settings.labels.yml'), path.join(config, 'settings.labels.yml'));
  fs.writeFileSync(path.join(config, 'settings.yml'), ['workspaces:', '  - dev', 'plugins:',
    ...['x-cloud', 'x-forge', 'x-drive'].map((n) => `  ${n}:\n    enabled: true`), ''].join('\n'));
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'plugin.x-cloud.settings.yml'), 'client_id: CHANGE_ME\nexclude:\n  - one\n');
  fs.writeFileSync(path.join(config, 'plugin.x-forge.settings.yml'), 'host: example.invalid\ntoken: CHANGE_ME\n');
  fs.writeFileSync(path.join(config, 'plugin.x-drive.settings.yml'),
    '# The id of the OAuth client, from the console.\nclient_id: CHANGE_ME\nhost: example.invalid\ntoken: CHANGE_ME\nexclude:\n  - .git\n');
  plugin('x-cloud', { settingsFile: 'plugin.x-cloud.settings.yml', labels: 'labels.yml' }, {
    'labels.yml': 'client_id:\n  label: Cloud client id\n  info: The cloud console hint.\nexclude:\n  label: Cloud exclusions\n',
  });
  plugin('x-forge', { settingsFile: 'plugin.x-forge.settings.yml' }, {
    'index.js': "module.exports.register = (api) => { api.addLabels({ token: { label: 'Forge token', info: 'The forge hint.' }, host: { label: 'Forge host' } }); };\n",
  });
  plugin('x-drive', { settingsFile: 'plugin.x-drive.settings.yml' });
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' } });
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

const form = async (file) => {
  const r = await fetch(`${base}/settings/${encodeURIComponent(file)}`);
  assert.strictEqual(r.status, 200, file);
  return r.text();
};
/** The name a field of the form carries: the text of its <label for>. */
const labelOf = (html, key) => {
  const at = html.indexOf(`name="k_`);
  assert.ok(at > 0, 'the form has fields');
  const rows = html.split('<div class="settings-row').slice(1);
  const row = rows.find((r) => r.includes(`value="${key}"`));
  assert.ok(row, `a row for ${key}`);
  return (row.match(/<label for="[^"]+"(?: id="[^"]+")?>([^<]*)<\/label>/) || [])[1];
};

test("a plugin's own labels name its own fields, from its labels file or from register(api)", async () => {
  const cloud = await form('plugin.x-cloud.settings.yml');
  assert.strictEqual(labelOf(cloud, 'client_id'), 'Cloud client id');
  assert.match(cloud, /The cloud console hint\./);
  const forge = await form('plugin.x-forge.settings.yml');
  assert.strictEqual(labelOf(forge, 'token'), 'Forge token');
  assert.strictEqual(labelOf(forge, 'host'), 'Forge host');
  assert.match(forge, /The forge hint\./);
});

test("another plugin's file with the same keys keeps its own names: never a label or a hint it did not give", async () => {
  const drive = await form('plugin.x-drive.settings.yml');
  assert.strictEqual(labelOf(drive, 'client_id'), 'client_id', 'not "Cloud client id"');
  assert.strictEqual(labelOf(drive, 'token'), 'token', 'not "Forge token"');
  assert.strictEqual(labelOf(drive, 'host'), 'host', 'not "Forge host"');
  for (const borrowed of ['Cloud client id', 'The cloud console hint.', 'Forge token', 'The forge hint.', 'Forge host', 'Cloud exclusions']) {
    assert.ok(!drive.includes(borrowed), `x-drive's form borrows "${borrowed}"`);
  }
  // With no label of its own, the comment above the key in the file is what explains it.
  assert.match(drive, /The id of the OAuth client, from the console\./);
});

test("a plugin's list is labelled by that plugin too, and its new-entry field has a name", async () => {
  const cloud = await form('plugin.x-cloud.settings.yml');
  assert.match(cloud, /<label class="settings-key" for="list-new-exclude">Cloud exclusions <span class="uk-text-meta">\(1\)<\/span><\/label>/);
  assert.match(cloud, /<input class="uk-input" id="list-new-exclude" name="newEntry" aria-label="Add to Cloud exclusions"/);
  const drive = await form('plugin.x-drive.settings.yml');
  assert.match(drive, /<label class="settings-key" for="list-new-exclude">exclude <span class="uk-text-meta">\(1\)<\/span><\/label>/);
  assert.match(drive, /aria-label="Add to exclude"/);
});

test('the files no plugin owns keep the dashboard\'s labels: the workspaces list of settings.yml', async () => {
  const main = await form('settings.yml');
  assert.match(main, /<label class="settings-key" for="list-new">Workspace folders <span class="uk-text-meta">\(1, in card order\)<\/span><\/label>/);
  assert.match(main, /aria-label="Add to Workspace folders"/);
});
