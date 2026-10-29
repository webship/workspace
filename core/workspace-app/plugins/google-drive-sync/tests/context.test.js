/**
 * The plugin's own settings file, and the one-time move of the old `google_drive:` block out of settings.yml.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = path.join(__dirname, '..');
const OLD = [
  '# Top of the file', 'hub_domain: workspace.ddev.site', '',
  'workspaces:', '  - docs', '  - videos', '',
  '# Google Drive: explains the block below.', '# A second comment line.',
  'google_drive:', '  client_id: the-id', '  client_secret: the-secret  # keep this comment', '  refresh_token: ""',
  '  destinations:', '    docs: DOCSFOLDER01', '  targets:', '    docs:', '      - "*.pdf"', '  exclude:', '    - node_modules', '',
  '# What follows is unrelated.', 'plugins:', '  workspace-notes:', '    enabled: true', '',
].join('\n');

function run(config, code) {
  const out = spawnSync('node', ['-e', code], { cwd: PLUGIN, env: { ...process.env, WORKSPACE_CONFIG: config, WORKSPACE_ROOT: path.dirname(path.dirname(config)) }, encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  return out.stdout.trim();
}
const fresh = (text) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-gd-ctx-')); const cfg = path.join(dir, 'core', 'config'); fs.mkdirSync(cfg, { recursive: true }); fs.writeFileSync(path.join(cfg, 'settings.yml'), text); return cfg; };

test('the old block moves into the plugin file once: values and comments kept, private to the owner, gone from settings.yml', () => {
  const cfg = fresh(OLD);
  assert.strictEqual(run(cfg, "console.log(require('./lib/context').migrate())"), 'true');
  const file = path.join(cfg, 'plugin.google-drive-sync.settings.yml');
  const moved = fs.readFileSync(file, 'utf8');
  assert.match(moved, /^# Google Drive: explains the block below\.\n# A second comment line\.\nclient_id: the-id\nclient_secret: the-secret  # keep this comment\nrefresh_token: ""\ndestinations:\n  docs: DOCSFOLDER01\ntargets:\n  docs:\n    - "\*\.pdf"\nexclude:\n  - node_modules\n$/);
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');
  const rest = fs.readFileSync(path.join(cfg, 'settings.yml'), 'utf8');
  assert.doesNotMatch(rest, /google_drive|the-secret|Google Drive: explains/);
  assert.match(rest, /# Top of the file\nhub_domain: workspace\.ddev\.site\n\nworkspaces:\n {2}- docs\n {2}- videos\n\n# What follows is unrelated\.\nplugins:\n {2}workspace-notes:\n {4}enabled: true\n/);
  assert.strictEqual(run(cfg, "console.log(require('./lib/context').migrate())"), 'false', 'a second run does nothing');
  assert.strictEqual(run(cfg, "console.log(require('./lib/context').pluginSettings().client_id)"), 'the-id');
});

test('before it is moved the old block is still read, and nothing is moved when there is nothing to move', () => {
  const cfg = fresh(OLD);
  assert.strictEqual(run(cfg, "console.log(require('./lib/context').pluginSettings().destinations.docs)"), 'DOCSFOLDER01');
  assert.strictEqual(fs.existsSync(path.join(cfg, 'plugin.google-drive-sync.settings.yml')), false, 'reading does not write');
  const none = fresh('workspaces:\n  - docs\n');
  assert.strictEqual(run(none, "console.log(require('./lib/context').migrate())"), 'false');
  assert.strictEqual(fs.existsSync(path.join(none, 'plugin.google-drive-sync.settings.yml')), false);
});

test('a workspace folder is its own doc.path, else <root>/<name>, and only a registered workspace is one', () => {
  const cfg = fresh('workspaces:\n  - docs\n  - videos\n');
  fs.writeFileSync(path.join(cfg, 'workspace.videos.settings.yml'), 'doc:\n  path: /somewhere/else\n');
  const root = path.dirname(path.dirname(cfg));
  const out = run(cfg, "const c = require('./lib/context'); console.log([c.workspaceDir('docs'), c.workspaceDir('videos'), c.workspaceDir('nope'), c.isValidWorkspace('docs'), c.isValidWorkspace('../x')].join('|'))");
  assert.strictEqual(out, `${path.join(root, 'docs')}|/somewhere/else||true|false`);
});
