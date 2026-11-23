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

test('asking for the help is not an error, and a word the tool does not know is named', () => {
  for (const args of [[], ['--help'], ['-h'], ['help']]) {
    const r = run(args);
    assert.strictEqual(r.status, 0, `${args.join(' ') || '(nothing)'} exits 0`);
    assert.match(r.stdout, /webship-workspace init \[dir\]/);
    assert.strictEqual(r.stderr, '');
  }
  const version = run(['--version']);
  assert.strictEqual(version.status, 0);
  assert.strictEqual(version.stdout.trim(), require('../../../../package.json').version);
  const bad = run(['frobnicate']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /there is no "frobnicate" command/);
  assert.match(bad.stderr, /webship-workspace init \[dir\]/, 'the help follows');
  assert.strictEqual(bad.stdout, '');
  // The plugin steps the same way: the help is not an error, a missing or unknown step is.
  const steps = run(['plugin', '--help']);
  assert.strictEqual(steps.status, 0);
  assert.match(steps.stdout, /plugin <require\|activate\|install/);
  const none = run(['plugin']);
  assert.strictEqual(none.status, 1);
  assert.match(none.stderr, /Which step\?/);
  const unknown = run(['plugin', 'explode', 'x']);
  assert.strictEqual(unknown.status, 1);
  assert.match(unknown.stderr, /there is no "explode" step/);
});

test('on a Node.js older than the package needs, the command says what it needs and does nothing', () => {
  const needed = require('../../../../package.json').engines.node.match(/(\d+)\.(\d+)/).slice(1, 3).join('.');
  const says = new RegExp(`needs Node\\.js ${needed.replace('.', '\\.')} or later: this is Node\\.js 20\\.20\\.2 \\(`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-old-node-'));
  const dir = path.join(tmp, 'ws');
  const old = { WEBSHIP_WORKSPACE_NODE_VERSION: '20.20.2' };
  try {
    for (const args of [['catalog'], ['doctor', dir], ['plugin', 'list'], ['init', dir], ['update', dir], ['status', dir], ['frobnicate']]) {
      const r = run(args, old);
      assert.strictEqual(r.status, 1, `${args[0]} ends with 1`);
      assert.match(r.stderr, says, args[0]);
      assert.match(r.stderr, /Nothing was changed\./, args[0]);
      assert.doesNotMatch(r.stderr + r.stdout, /SyntaxError|node:internal/, `${args[0]}: no stack trace`);
      assert.strictEqual(r.stdout, '', `${args[0]} prints nothing else`);
    }
    assert.ok(!fs.existsSync(dir), 'init and update made nothing');
    // The version and the help still answer, also the help of the plugin steps.
    for (const args of [['--version'], ['version'], ['-v'], [], ['help'], ['--help'], ['-h'], ['plugin', '--help']]) {
      const r = run(args, old);
      assert.strictEqual(r.status, 0, `${args.join(' ') || '(nothing)'} still answers`);
      assert.strictEqual(r.stderr, '');
    }
    // One release below the lowest is refused; the lowest itself and newer ones run.
    const [major, minor] = needed.split('.').map(Number);
    assert.strictEqual(run(['catalog'], { WEBSHIP_WORKSPACE_NODE_VERSION: `${major}.${minor - 1}.9` }).status, 1);
    assert.strictEqual(run(['catalog'], { WEBSHIP_WORKSPACE_NODE_VERSION: `v${major - 1}.99.0` }).status, 1);
    for (const v of [`${major}.${minor}.0`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`, 'v26.13.1']) {
      const r = run(['catalog'], { WEBSHIP_WORKSPACE_NODE_VERSION: v });
      assert.strictEqual(r.status, 0, `${v} runs`);
      assert.match(r.stdout, /@webship\.co\/workspace-/);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('plugin, doctor and update are about the workspace they are run in, not ~/workspace', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-where-'));
  const home = path.join(base, 'home');
  const mine = path.join(base, 'sites', 'mine');
  fs.mkdirSync(home, { recursive: true });
  assert.strictEqual(run(['init', mine]).status, 0);
  // A stand-in for the script, so the test reads which workspace was meant and with which arguments.
  fs.writeFileSync(path.join(mine, 'core', 'scripts', 'plugins.sh'), '#!/usr/bin/env bash\necho "ROOT: $WORKSPACE_ROOT ARGS: $*"\n');
  const clean = { HOME: home, WORKSPACE_ROOT: '', WEBSHIP_WORKSPACE_DIR: '' };
  const at = (cwd, args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', ...clean } });
  // From the workspace, and from a folder inside it.
  for (const cwd of [mine, path.join(mine, 'core', 'workspace-app')]) {
    const r = at(cwd, ['plugin', 'list']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), `ROOT: ${fs.realpathSync(mine)} ARGS: --list`);
  }
  // From a folder that is in no workspace: ~/workspace, and the message says where it looked.
  const out = at(base, ['plugin', 'list']);
  assert.strictEqual(out.status, 1);
  assert.match(out.stderr, new RegExp(`No workspace at ${path.join(home, 'workspace').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // update: the workspace it stands in; where there is none it makes nothing.
  const up = at(mine, ['update']);
  assert.strictEqual(up.status, 0, up.stderr);
  assert.match(up.stdout, new RegExp(`Updating the Webship Workspace at ${fs.realpathSync(mine).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const nowhere = path.join(base, 'not-a-workspace');
  const no = at(base, ['update', nowhere]);
  assert.strictEqual(no.status, 1);
  assert.match(no.stderr, /No workspace at .*not-a-workspace: nothing to update/);
  assert.ok(!fs.existsSync(nowhere), 'update made no folder');
  // doctor: says when the folder it was given is no workspace.
  const doc = at(base, ['doctor', nowhere]);
  assert.match(doc.stdout, /No workspace at .*not-a-workspace/);
});

test('init gives the dashboard\'s address only when the dashboard was started', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-started-'));
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin);
  const ddev = (startExit) => fs.writeFileSync(path.join(bin, 'ddev'), `#!/usr/bin/env bash\n[ "$1" = "--version" ] && { echo "ddev version v1.24.0" ; exit 0 ; }\necho "ddev $*"\nexit ${startExit}\n`, { mode: 0o755 });
  const init = (dir, env) => spawnSync(process.execPath, [BIN, 'init', dir], { encoding: 'utf8', env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '', ...env } });
  const withDdev = { PATH: `${bin}:${process.env.PATH}` };

  // Not asked to start it: no "Done. The dashboard: <address>", the line to start it instead.
  const skipped = init(path.join(base, 'a'), { WEBSHIP_WORKSPACE_SKIP_DDEV: '1' });
  assert.strictEqual(skipped.status, 0, skipped.stderr);
  assert.doesNotMatch(skipped.stdout, /The dashboard: https/);
  assert.match(skipped.stdout, /The dashboard was not started .*ddev start/);

  // Started: the address.
  ddev(0);
  const started = init(path.join(base, 'b'), withDdev);
  assert.strictEqual(started.status, 0, started.stderr);
  assert.match(started.stdout, /Done\. The dashboard: https:\/\/workspace\.ddev\.site/);

  // ddev start failed: said, with the line to try again, and the exit code is 1.
  ddev(1);
  const failed = init(path.join(base, 'c'), withDdev);
  assert.strictEqual(failed.status, 1);
  assert.doesNotMatch(failed.stdout, /Done\./);
  assert.match(failed.stdout, /the dashboard did not start/);
  assert.ok(fs.existsSync(path.join(base, 'c', 'core', 'config', 'settings.yml')), 'the workspace itself is there');

  // No ddev on the machine at all.
  const empty = path.join(base, 'empty-bin');
  fs.mkdirSync(empty);
  fs.symlinkSync(process.execPath, path.join(empty, 'node'));
  const none = init(path.join(base, 'd'), { PATH: empty });
  assert.strictEqual(none.status, 0, none.stderr);
  assert.doesNotMatch(none.stdout, /Done\. The dashboard: https/);
  assert.match(none.stdout, /The dashboard is not started: DDEV is missing/);
});
