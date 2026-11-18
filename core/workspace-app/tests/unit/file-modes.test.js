/**
 * The files that hold secrets are readable by their owner only, when they are made and after a save.
 *
 * settings.yml is made 600, but a save in the raw editor wrote a new file and renamed it over it with the
 * process's umask (664 here, 644 on most machines). A workspace's settings file (Penpot's password, RAG's
 * token) was placed with the package file's mode. A backup (the project's settings, its .env, the database
 * dump beside it) was made with the shell's umask.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);

test('a settings save leaves the file owner-only, from the raw editor and from the fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-modes-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  const file = path.join(config, 'settings.yml');
  fs.writeFileSync(file, 'account:\n  name: webmaster\n  pass: CHANGE_ME\nai_providers:\n  openai:\n    api_key: sk-change-this\nworkspaces:\n  - dev\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  const r = spawnSync(process.execPath, ['-e', `
    process.umask(0o002);
    const sf = require('./settings-file');
    const yaml = require('js-yaml');
    const fs = require('fs');
    const f = ${JSON.stringify(file)};
    const text = fs.readFileSync(f, 'utf8').replace('webmaster', 'admin');
    const a = sf.writeSettingsText('settings.yml', text, { yaml });
    if (a.error) throw new Error(a.error);
    console.log('raw', (fs.statSync(f).mode & 0o777).toString(8));
    fs.chmodSync(f, 0o664);
    const row = sf.readSettingsRows('settings.yml').find((x) => x.dotted === 'account.name');
    sf.writeSettingsValues('settings.yml', [{ line: row.line, key: row.key, value: 'editor' }]);
    console.log('fields', (fs.statSync(f).mode & 0o777).toString(8));
  `], { cwd: APP, env: { ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config }, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^raw 600$/m, 'the raw editor keeps it 600 (it was 664 after a save)');
  assert.match(r.stdout, /^fields 600$/m, 'a field save makes a file found 664 owner-only');
  assert.match(fs.readFileSync(file, 'utf8'), /name: editor/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a workspace settings file is placed owner-only, and one placed before is made so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-modes-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\nplugins:\n  x-folder:\n    enabled: true\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  const plugins = path.join(root, 'plugins');
  const dir = path.join(plugins, 'x-folder');
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-folder', version: '0.1.0', main: 'index.js',
    workspacePlugin: { name: 'x-folder', workspace: { key: 'x-folder', settingsTemplate: 'config/workspace.x-folder.settings.yml' } } }));
  fs.writeFileSync(path.join(dir, 'config', 'workspace.x-folder.settings.yml'), 'doc:\n  name: x-folder\nservice:\n  password: CHANGE_ME\n', { mode: 0o664 });
  fs.chmodSync(path.join(dir, 'config', 'workspace.x-folder.settings.yml'), 0o664);
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  const env = { ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  const install = () => spawnSync(process.execPath, ['-e', "process.umask(0o002); require('./plugin-install.js').install('x-folder');"], { cwd: APP, env, encoding: 'utf8' });
  let r = install();
  assert.strictEqual(r.status, 0, r.stderr);
  const placed = path.join(config, 'workspace.x-folder.settings.yml');
  assert.strictEqual(mode(placed), '600', 'placed owner-only');
  fs.chmodSync(placed, 0o664);
  r = install();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(mode(placed), '600', 'one found readable by others is made owner-only');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a backup archive and its folder are owner-only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-modes-'));
  fs.mkdirSync(path.join(root, 'dev', 'site1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site1', '.env'), 'DB_PASSWORD=x\n');
  const fun = path.join(APP, '..', 'scripts', 'functions', 'fun-backup-item.sh');
  const r = spawnSync('bash', ['-c', `umask 002; cd ${JSON.stringify(path.join(root, 'dev'))}; backups=${JSON.stringify(path.join(root, 'backups'))}; doc_name=dev; source ${JSON.stringify(fun)}; backup_workspace_item site1 > /dev/null && echo "$BACKUP_ARCHIVE"`], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const archive = r.stdout.trim();
  assert.ok(fs.existsSync(archive), archive);
  assert.strictEqual(mode(archive), '600');
  assert.strictEqual(mode(path.dirname(archive)), '700');
  fs.rmSync(root, { recursive: true, force: true });
});
