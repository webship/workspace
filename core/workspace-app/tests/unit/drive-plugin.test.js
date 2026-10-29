/**
 * The Google Drive sync plugin: where its button appears, what it saves, and what it refuses.
 *
 * Runs against a copy of the shipped config, so the settings the plugin writes back never touch a
 * real settings.yml. Nothing here talks to Google.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-drive-plugin-'));
fs.cpSync(path.join(__dirname, '..', '..', '..', 'config'), CONFIG, { recursive: true });
process.env.WORKSPACE_CONFIG = CONFIG;

const { pluginActions, pluginFragment, pluginPageActionGroups, loadedPlugins } = require('../../plugin-loader');
const { loadWorkspaces } = require('../../workspaces');

const PLUGIN_FILE = 'plugin.google-drive-sync.settings.yml';
const settingsText = () => fs.readFileSync(path.join(CONFIG, PLUGIN_FILE), 'utf8');   // the plugin's own file
const call = (route, form, workspace) => new Promise((resolve) => {
  const out = {};
  const send = (html, status = 200) => { out.html = html; out.status = status; resolve(out); };
  pluginActions[route]({ form, send, workspace, res: {}, pathname: route });
});

test('the plugin is on in the shipped settings, for the four file workspaces and the test one', () => {
  assert.ok(loadedPlugins.some((p) => p.name === 'google-drive-sync'));
  const shown = Object.entries(loadWorkspaces())
    .filter(([key, meta]) => pluginPageActionGroups('workspace', key, meta).some((g) => g.label === 'Google Drive'))
    .map(([key]) => key).sort();
  assert.deepStrictEqual(shown, ['audio', 'docs', 'specs', 'test', 'videos']);
});

test('the plugin has its own settings file with every key, and settings.yml no longer carries any of it', () => {
  const file = settingsText();
  for (const key of ['client_id', 'client_secret', 'refresh_token', 'scope', 'redirect_uri', 'root_folder', 'locations', 'account']) assert.match(file, new RegExp(`^${key}:`, 'm'));
  for (const ws of ['videos', 'audio', 'docs', 'specs', 'test']) assert.match(file, new RegExp(`\\n  ${ws}:`));
  assert.match(file, /\nsources:\n  test: test-reports/);
  assert.match(file, /\nexclude:\n  - node_modules/);
  assert.doesNotMatch(fs.readFileSync(path.join(CONFIG, 'settings.yml'), 'utf8'), /^google_drive:/m, 'the block left settings.yml');
});

test('the plugin loads as a node module, with a folder only as the fallback', () => {
  const entry = loadedPlugins.find((p) => p.name === 'google-drive-sync');
  assert.match(entry.source, /^module:@webship\/workspace-google-drive$/, `loaded as ${entry.source}`);
  assert.strictEqual(require('../../package.json').dependencies['@webship/workspace-google-drive'], 'file:plugins/google-drive-sync');
  const manifest = require('../../plugins/google-drive-sync/package.json');
  assert.strictEqual(manifest.main, 'index.js');
  assert.strictEqual(manifest.workspacePlugin.settingsFile, PLUGIN_FILE);
});

test('the plugin touches nothing of the dashboard but the api it is handed', () => {
  const dir = path.join(__dirname, '..', '..', 'plugins', 'google-drive-sync');
  const files = [path.join(dir, 'index.js'), ...fs.readdirSync(path.join(dir, 'lib')).map((f) => path.join(dir, 'lib', f))];
  for (const f of files) {
    const reaches = [...fs.readFileSync(f, 'utf8').matchAll(/require\(['"](\.\.\/[^'"]+)['"]\)/g)].map((m) => m[1]);
    for (const r of reaches) assert.ok(path.resolve(path.dirname(f), r).startsWith(dir), `${path.relative(dir, f)} requires ${r}, which is outside the package`);
  }
});

test('the test workspace says it pushes reports, and the others do not', () => {
  const labels = (key) => pluginPageActionGroups('workspace', key, loadWorkspaces()[key]).find((g) => g.label === 'Google Drive').items[0];
  assert.match(labels('test'), /Sync test reports/);
  assert.match(labels('docs'), /Sync to Drive/);
});

test('a callback with an unknown state is refused, so a forged link cannot plant a token', () => {
  const res = { headers: {}, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  assert.ok(pluginFragment('/fragments/p/google-drive-sync/callback', { url: '/fragments/p/google-drive-sync/callback?code=x&state=forged' }, res));
  assert.strictEqual(res.status, 400);
  assert.match(res.body, /expired/);
  assert.doesNotMatch(settingsText(), /refresh_token: x/);
});

test('it will not choose My Drive or a file, and a workspace outside its scope gets nothing', async () => {
  const root = await call('/actions/p/google-drive-sync/choose', { folder: 'root' }, 'videos');
  assert.strictEqual(root.status, 400);
  const nonsense = await call('/actions/p/google-drive-sync/choose', { folder: 'not a folder' }, 'videos');
  assert.strictEqual(nonsense.status, 400);
  const outside = await call('/actions/p/google-drive-sync/sync', {}, 'dev');
  assert.strictEqual(outside.status, 400);
  assert.match(outside.html, /not enabled/);
});

test('Disconnect clears the token and leaves a line the next Connect can write again', async () => {
  fs.writeFileSync(path.join(CONFIG, PLUGIN_FILE), settingsText().replace('refresh_token: ""', 'refresh_token: 1//abc'));
  const { readSettingsRows } = require('../../settings-file');
  assert.ok(readSettingsRows(PLUGIN_FILE).some((r) => r.dotted === 'refresh_token' && r.secret), 'it is a secret row');
  await call('/actions/p/google-drive-sync/disconnect', {}, 'videos');
  assert.match(settingsText(), /refresh_token: ""/);
  assert.ok(readSettingsRows(PLUGIN_FILE).some((r) => r.dotted === 'refresh_token'), 'still an editable row');
});

test('the plugin is on for a settings.yml that has never heard of it, and a line in the file can still turn it off', () => {
  const { spawnSync } = require('child_process');
  const load = (settings) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-plugin-default-'));
    fs.cpSync(path.join(__dirname, '..', '..', '..', 'config'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.yml'), settings);
    const run = spawnSync('node', ['-e', "console.log(require('./plugin-loader').loadedPlugins.map((p) => p.name).join(','))"], { env: { ...process.env, WORKSPACE_CONFIG: dir }, cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
    return run.stdout.trim();
  };
  assert.match(load('workspaces:\n  - docs\n'), /google-drive-sync/);
  assert.doesNotMatch(load('workspaces:\n  - docs\nplugins:\n  google-drive-sync:\n    enabled: false\n'), /google-drive-sync/);
});

test('the Google account setting is read, and Connect pre-selects it in the account chooser', () => {
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-account-'));
  fs.writeFileSync(path.join(dir, PLUGIN_FILE), 'client_id: cid\nclient_secret: csecret1234\naccount: Someone@Example.com\n');
  const run = spawnSync('node', ['-e', "const d = require('./plugins/google-drive-sync/lib/drive'); console.log(d.driveSettings().account, new URL(d.authUrl('s', d.driveSettings().account)).searchParams.get('login_hint'))"], { env: { ...process.env, WORKSPACE_CONFIG: dir }, cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
  assert.strictEqual(run.stdout.trim(), 'someone@example.com someone@example.com', run.stderr);
});

test('the targets are saved from the panel, and a target that could reach outside the workspace is refused', async () => {
  const yaml = require('js-yaml');
  const saved = await call('/actions/p/google-drive-sync/targets', { targets: '*.mp4\n guide/ \n\n*-poster.jpg\r\n' }, 'videos');
  assert.strictEqual(saved.status, 200);
  assert.deepStrictEqual(yaml.load(settingsText()).targets.videos, ['*.mp4', 'guide/', '*-poster.jpg']);
  for (const bad of ['../secrets', '/etc/passwd', 'a/../../b', 'x"y', 'back\\slash', '$(id)']) {
    const r = await call('/actions/p/google-drive-sync/targets', { targets: `*.mp4\n${bad}` }, 'videos');
    assert.strictEqual(r.status, 400, `${bad} should be refused`);
  }
  assert.deepStrictEqual(yaml.load(settingsText()).targets.videos, ['*.mp4', 'guide/', '*-poster.jpg'], 'a refused save changes nothing');
  const outside = await call('/actions/p/google-drive-sync/targets', { targets: '*.md' }, 'dev');
  assert.strictEqual(outside.status, 400);
});

test('a plugin settings file that does not exist yet is created private to the owner, on the first save', async () => {
  fs.rmSync(path.join(CONFIG, PLUGIN_FILE));
  const saved = await call('/actions/p/google-drive-sync/targets', { targets: '*.pdf' }, 'docs');
  assert.strictEqual(saved.status, 200);
  const file = path.join(CONFIG, PLUGIN_FILE);
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600', 'it can hold a client secret and a refresh token');
  assert.deepStrictEqual(require('js-yaml').load(fs.readFileSync(file, 'utf8')).targets.docs, ['*.pdf']);
});
