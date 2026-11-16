/**
 * A plugin update keeps what a person changed in the files the plugin placed (#404).
 *
 * Records written by 1.0.15 and earlier hold no hash for a plugin's commands, functions or features, so an
 * install could not tell a person's edit from the old version's copy and wrote the new one over it without a
 * word. `remember` notes, from the package still in node_modules, how the installed version shipped each file;
 * the next install then keeps a changed file as <file>.yours before writing the new copy, and keeps a changed
 * file the new version no longer ships.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function pkg(dir, version, { cmd, fun, files }) {
  for (const d of ['commands', 'scripts/functions']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-x-up', version, main: 'index.js',
    workspacePlugin: { name: 'x-up', commands: { types: ['sites'], files }, scripts: { functions: ['scripts/functions/fun-x-up.sh'] } } }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  fs.writeFileSync(path.join(dir, 'commands', 'cmd-x-up.sh'), cmd);
  fs.writeFileSync(path.join(dir, 'scripts', 'functions', 'fun-x-up.sh'), fun);
  fs.writeFileSync(path.join(dir, 'commands', 'cmd-x-gone.sh'), '#!/usr/bin/env bash\n# gone in 0.2.0\n');
  fs.writeFileSync(path.join(dir, 'commands', 'cmd-x-kept.sh'), '#!/usr/bin/env bash\n# gone in 0.2.0 too\n');
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-keep-edits-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'workspace-app', '.ddev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\nplugins:\n  x-up:\n    enabled: true\n');
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  const plugins = path.join(root, 'plugins');
  const dir = path.join(plugins, 'x-up');
  pkg(dir, '0.1.0', { cmd: '#!/usr/bin/env bash\n# x-up 0.1.0 in __WORKSPACE__\n', fun: 'x_up() { echo 0.1.0; }\n',
    files: ['commands/cmd-x-up.sh', 'commands/cmd-x-gone.sh', 'commands/cmd-x-kept.sh'] });
  const env = { ...process.env, WORKSPACE_ROOT: root, WORKSPACE_CONFIG: config, WORKSPACE_PLUGINS_DIR: plugins, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  const run = (...args) => spawnSync(process.execPath, ['plugin-install.js', ...args], { cwd: APP, env, encoding: 'utf8' });
  const record = () => yaml.load(fs.readFileSync(path.join(config, 'plugins.installed.yml'), 'utf8')) || {};
  const writeRecord = (r) => fs.writeFileSync(path.join(config, 'plugins.installed.yml'), yaml.dump(r));
  return { root, config, plugins, dir, env, run, record, writeRecord };
}

test('an update keeps a command a person changed (as .yours) and a dropped file they changed, on a record from before hashes', () => {
  const t = tree();
  assert.strictEqual(t.run('install', 'x-up').status, 0);
  // A record as 1.0.15 and earlier wrote it: the placed paths, no hashes.
  const old = t.record();
  delete old['x-up'].hashes;
  t.writeRecord(old);
  const cmd = path.join(t.root, 'dev', 'cmd-x-up.sh');
  fs.appendFileSync(cmd, '# my own line\n');
  fs.appendFileSync(path.join(t.root, 'dev', 'cmd-x-kept.sh'), '# mine too\n');
  const mine = fs.readFileSync(cmd, 'utf8');

  // Before npm replaces the package: how 0.1.0 shipped each placed file.
  const r = t.run('remember');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /x-up: noted how 0\.1\.0 shipped 4 placed file\(s\)/);
  const h = t.record()['x-up'].hashes;
  assert.strictEqual(h['dev/cmd-x-up.sh'], sha('#!/usr/bin/env bash\n# x-up 0.1.0 in dev\n'), 'the hash of the copy 0.1.0 placed, not of the edited file');
  assert.strictEqual(h['core/scripts/plugins/x-up/functions/fun-x-up.sh'], sha('x_up() { echo 0.1.0; }\n'));

  // The new version: a new command and function, and two commands it no longer ships.
  pkg(t.dir, '0.2.0', { cmd: '#!/usr/bin/env bash\n# x-up 0.2.0 in __WORKSPACE__\n', fun: 'x_up() { echo 0.2.0; }\n', files: ['commands/cmd-x-up.sh'] });
  const i = t.run('install', 'x-up');
  assert.strictEqual(i.status, 0, i.stderr);
  assert.strictEqual(fs.readFileSync(cmd, 'utf8'), '#!/usr/bin/env bash\n# x-up 0.2.0 in dev\n', 'the new version is placed');
  assert.strictEqual(fs.readFileSync(`${cmd}.yours`, 'utf8'), mine, 'the changed copy is kept beside it');
  assert.match(i.stdout, /replaced dev\/cmd-x-up\.sh \(it had been changed here; a plugin's own files follow the package\): your copy is kept as dev\/cmd-x-up\.sh\.yours/);
  assert.strictEqual(fs.readFileSync(path.join(t.root, 'core', 'scripts', 'plugins', 'x-up', 'functions', 'fun-x-up.sh'), 'utf8'), 'x_up() { echo 0.2.0; }\n');
  assert.ok(!fs.existsSync(path.join(t.root, 'core', 'scripts', 'plugins', 'x-up', 'functions', 'fun-x-up.sh.yours')), 'a file nobody changed is just updated');
  assert.ok(!fs.existsSync(path.join(t.root, 'dev', 'cmd-x-gone.sh')), 'a dropped file nobody changed goes');
  assert.match(fs.readFileSync(path.join(t.root, 'dev', 'cmd-x-kept.sh'), 'utf8'), /# mine too/, 'a dropped file a person changed stays');
  assert.match(i.stdout, /kept dev\/cmd-x-kept\.sh \(this version no longer ships it, and it was changed here: it is yours now\)/);

  // Again: nothing is replaced, nothing new is kept.
  const again = t.run('install', 'x-up');
  assert.strictEqual(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /replaced|\.yours/);
  assert.deepStrictEqual(fs.readdirSync(path.join(t.root, 'dev')).filter((f) => /\.yours/.test(f)), ['cmd-x-up.sh.yours']);
});

test('remember guesses nothing when the package is no longer the version that placed the files', () => {
  const t = tree();
  assert.strictEqual(t.run('install', 'x-up').status, 0);
  const old = t.record();
  delete old['x-up'].hashes;
  old['x-up'].version = '0.0.9';
  t.writeRecord(old);
  const r = t.run('remember');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '');
  assert.strictEqual(t.record()['x-up'].hashes, undefined);
});

test('a second edit in a row keeps both copies, under free names', () => {
  const t = tree();
  assert.strictEqual(t.run('install', 'x-up').status, 0);
  const cmd = path.join(t.root, 'dev', 'cmd-x-up.sh');
  fs.writeFileSync(`${cmd}.yours`, 'an older copy of mine\n');
  fs.appendFileSync(cmd, '# changed\n');
  pkg(t.dir, '0.2.0', { cmd: '#!/usr/bin/env bash\n# x-up 0.2.0 in __WORKSPACE__\n', fun: 'x_up() { echo 0.2.0; }\n', files: ['commands/cmd-x-up.sh'] });
  const i = t.run('install', 'x-up');
  assert.strictEqual(i.status, 0, i.stderr);
  assert.strictEqual(fs.readFileSync(`${cmd}.yours`, 'utf8'), 'an older copy of mine\n', 'what was kept before stays');
  assert.match(fs.readFileSync(`${cmd}.yours-2`, 'utf8'), /# changed/);
  assert.match(i.stdout, /your copy is kept as dev\/cmd-x-up\.sh\.yours-2/);
});

test('plugins.sh --require notes the hashes before npm replaces the package', () => {
  const t = tree();
  assert.strictEqual(t.run('install', 'x-up').status, 0);
  const old = t.record();
  delete old['x-up'].hashes;
  t.writeRecord(old);
  // A stand-in npm that only says whether the record had the hashes when it was called.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-fake-npm-'));
  const seen = path.join(bin, 'seen');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env bash\ngrep -c 'dev/cmd-x-up.sh: ' "${path.join(t.config, 'plugins.installed.yml')}" > "${seen}"\nexit 0\n`, { mode: 0o755 });
  const r = spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--require', './x-up-0.2.0.tgz'], { cwd: t.root,
    env: { ...t.env, WORKSPACE_SCRIPTS: SCRIPTS, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60000 });
  assert.ok(fs.existsSync(seen), `npm was called: ${r.stdout}${r.stderr}`);
  assert.strictEqual(fs.readFileSync(seen, 'utf8').trim(), '1', 'the hash of the command was in the record before npm ran');
});

test('webship-workspace update notes the hashes while the plugins are still the versions that placed their files', () => {
  const BIN = path.join(APP, '..', 'bin', 'workspace.js');
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-update-remember-')), 'workspace');
  const cli = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8',
    env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1', ...extra } });
  assert.strictEqual(cli(['init', dir]).status, 0);
  // The dashboard's dependencies as an installed workspace has them, and one plugin installed from a folder.
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(dir, 'core', 'workspace-app', 'node_modules'), 'dir');
  const plugins = path.join(dir, 'local-plugins');
  pkg(path.join(plugins, 'x-up'), '0.1.0', { cmd: '#!/usr/bin/env bash\n# x-up 0.1.0 in __WORKSPACE__\n', fun: 'x_up() { echo 0.1.0; }\n', files: ['commands/cmd-x-up.sh'] });
  const config = path.join(dir, 'core', 'config');
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\nplugins:\n  x-up:\n    enabled: true\n');
  fs.writeFileSync(path.join(config, 'workspace.dev.settings.yml'), 'doc:\n  name: dev\ntype: sites\n');
  fs.mkdirSync(path.join(dir, 'dev'));
  const env = { WORKSPACE_PLUGINS_DIR: plugins };
  const i = spawnSync(process.execPath, ['plugin-install.js', 'install', 'x-up'], { cwd: path.join(dir, 'core', 'workspace-app'), encoding: 'utf8', env: { ...process.env, WORKSPACE_ROOT: dir, ...env, WORKSPACE_PLUGINS_NO_RESTART: '1' } });
  assert.strictEqual(i.status, 0, i.stderr);
  const recordFile = path.join(config, 'plugins.installed.yml');
  const old = yaml.load(fs.readFileSync(recordFile, 'utf8'));
  delete old['x-up'].hashes;
  fs.writeFileSync(recordFile, yaml.dump(old));
  const u = cli(['update', dir], env);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.match(u.stdout, /noted how the installed version of 1 plugin\(s\) shipped what it placed/);
  assert.strictEqual(yaml.load(fs.readFileSync(recordFile, 'utf8'))['x-up'].hashes['dev/cmd-x-up.sh'], sha('#!/usr/bin/env bash\n# x-up 0.1.0 in dev\n'));
});

test('a folder plugin installed later, which places the other plugins\' files again, says what it kept', () => {
  const t = tree();
  assert.strictEqual(t.run('install', 'x-up').status, 0);
  const cmd = path.join(t.root, 'dev', 'cmd-x-up.sh');
  fs.appendFileSync(cmd, '# my own line\n');
  // A workspace folder plugin: its install reaches every installed plugin's commands again.
  const dir = path.join(t.plugins, 'y-folder');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@webship.co/workspace-y-folder', version: '1.0.0', main: 'index.js',
    workspacePlugin: { name: 'y-folder', workspace: { key: 'y-folder' } } }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports.register = () => {};');
  const r = t.run('install', 'y-folder');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /x-up: replaced dev\/cmd-x-up\.sh \(it had been changed here; a plugin's own files follow the package\): your copy is kept as dev\/cmd-x-up\.sh\.yours/);
  assert.match(fs.readFileSync(`${cmd}.yours`, 'utf8'), /# my own line/);
});
