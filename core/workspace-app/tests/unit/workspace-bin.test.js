/**
 * The npm way in: `webship-workspace init` makes an EMPTY workspace from this package (the core, a
 * settings file with no workspaces and no plugins, the dashboard's dependencies), never overwrites a
 * settings file on a second run, and `catalog` says what can be added.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'workspace.js');
const run = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', ...env } });

test('init makes an empty workspace: the core, the lean settings, nothing else', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-init-')), 'workspace');
  const r = run(['init', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /settings\.yml written \(empty/);
  for (const f of ['core/scripts/plugins.sh', 'core/scripts/bootstrap.sh', 'core/workspace-app/server.js', 'core/workspace-app/plugin-loader.js', 'core/workspace-app/package.json', 'core/workspace-app/.app-version', 'core/config/settings.yml', 'README.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} is there`);
  }
  assert.ok(!fs.existsSync(path.join(dir, 'core', 'workspace-app', 'node_modules')), 'no node_modules copied');
  const settings = fs.readFileSync(path.join(dir, 'core', 'config', 'settings.yml'), 'utf8');
  assert.match(settings, /^workspaces: \[\]$/m, 'no workspace folders yet');
  assert.match(settings, /^plugins: \{\}$/m, 'no plugins yet');
  assert.ok(!fs.existsSync(path.join(dir, 'dev')), 'no folders made');
  assert.match(r.stdout, /Workspace folders — /, 'the catalogue is suggested');
  // Again: a settings file a person may have edited is kept.
  fs.appendFileSync(path.join(dir, 'core', 'config', 'settings.yml'), '# mine\n');
  const r2 = run(['update', dir]);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /settings\.yml kept/);
  assert.match(fs.readFileSync(path.join(dir, 'core', 'config', 'settings.yml'), 'utf8'), /# mine/);
});

test('the catalogue names every family with its npm packages, and plugin refuses an unknown verb', () => {
  const r = run(['catalog']);
  assert.strictEqual(r.status, 0);
  for (const f of ['Workspace folders', 'Hosting providers', 'Git forges', 'Container runtimes']) assert.match(r.stdout, new RegExp(f));
  assert.match(r.stdout, /@webship\.co\/workspace-github/);
  const bad = run(['plugin', 'explode', 'x']);
  assert.strictEqual(bad.status, 1);
  const none = run(['plugin', 'list'], { WORKSPACE_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'ws-none-')) });
  assert.strictEqual(none.status, 1);
  assert.match(none.stderr, /webship-workspace init/);
});
