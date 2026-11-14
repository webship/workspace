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

test('update keeps the plugins a person required in the dashboard\'s package.json, and takes the core\'s own lines', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-update-')), 'workspace');
  assert.strictEqual(run(['init', dir]).status, 0);
  const file = path.join(dir, 'core', 'workspace-app', 'package.json');
  const shipped = JSON.parse(fs.readFileSync(file, 'utf8'));
  // What `plugin require` leaves: one from npm, one from a repository, one from a path; and a core line someone changed.
  const mine = JSON.parse(JSON.stringify(shipped));
  mine.dependencies['@webship.co/workspace-wordpress'] = '^1.0.7';
  mine.dependencies['@webship.co/workspace-dev'] = 'github:webship/workspace-dev';
  mine.devDependencies = { ...(mine.devDependencies || {}), '@webship.co/workspace-x-local': 'file:../../plugins/x-local' };
  mine.dependencies['js-yaml'] = '^0.0.1';
  mine.version = '0.0.1';
  fs.writeFileSync(file, JSON.stringify(mine, null, 2));
  const r = run(['update', dir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(after.dependencies['@webship.co/workspace-wordpress'], '^1.0.7', 'a plugin from npm stays');
  assert.strictEqual(after.dependencies['@webship.co/workspace-dev'], 'github:webship/workspace-dev', 'a plugin from a repository stays');
  assert.strictEqual(after.devDependencies['@webship.co/workspace-x-local'], 'file:../../plugins/x-local', 'a plugin from a path stays');
  assert.strictEqual(after.dependencies['js-yaml'], shipped.dependencies['js-yaml'], 'a dependency of the core is the core\'s');
  assert.strictEqual(after.version, shipped.version, 'the rest of the file is the core\'s');
  assert.deepStrictEqual(Object.keys(after.dependencies).filter((k) => !k.startsWith('@webship.co/workspace-')), Object.keys(shipped.dependencies), 'nothing else is added');
  // A second update changes nothing more.
  assert.strictEqual(run(['update', dir]).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), after);
});
