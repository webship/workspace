/**
 * The `webship-workspace` command where npm puts it: under node_modules.
 *
 * Node.js runs no TypeScript file that lies under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). The
 * command loaded the plugin catalogue from plugin-catalog.mts of the package, so from an installed package `catalog`
 * failed, and `init` and `update` did their work and then failed where they print the catalogue. The other tests run
 * the command from the repository, which is under no node_modules, so none of them saw it.
 *
 * This packs the package as it is published, unpacks it under a node_modules folder and runs the command from there.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const has = (cmd) => !spawnSync(cmd, ['--version'], { encoding: 'utf8' }).error;
const NO_TRACE = /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|SyntaxError|node:internal/;
const { projectOfTmp } = require('./_docksal-tmp');
const projectOfTmpAtStart = projectOfTmp();

test('from the installed package the command runs: catalog, init, update and doctor', { skip: !(has('npm') && has('tar')) && 'npm and tar are needed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-from-npm-'));
  try {
    const packed = spawnSync('npm', ['pack', '--silent', '--pack-destination', tmp], { cwd: REPO, encoding: 'utf8' });
    assert.strictEqual(packed.status, 0, packed.stderr);
    const tarball = path.join(tmp, packed.stdout.trim().split('\n').pop());
    const scope = path.join(tmp, 'prefix', 'node_modules', '@webship.co');
    fs.mkdirSync(scope, { recursive: true });
    assert.strictEqual(spawnSync('tar', ['-xzf', tarball, '-C', scope], { encoding: 'utf8' }).status, 0);
    fs.renameSync(path.join(scope, 'package'), path.join(scope, 'workspace'));
    const pkg = path.join(scope, 'workspace');
    const bin = path.join(pkg, 'core', 'bin', 'workspace.js');
    assert.ok(fs.existsSync(path.join(pkg, 'core', 'workspace-app', 'plugin-catalog.json')), 'the package ships the catalogue\'s data');
    // HOME is the sandbox's: `doctor` with no workspace named reads ~/workspace, and it must not reach the machine's own
    // (it ran that workspace's command check and its plugins' commands, Docksal's fin among them, from this sandbox
    // under /tmp: #772).
    const run = (args, cwd = tmp) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8',
      env: { ...process.env, HOME: tmp, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1', WORKSPACE_ROOT: '', WORKSPACE_PATH: '', WORKSPACE_SCRIPTS: '', WORKSPACE_CONFIG: '' } });

    const catalog = run(['catalog']);
    assert.doesNotMatch(catalog.stderr, NO_TRACE);
    assert.strictEqual(catalog.status, 0, catalog.stderr);
    assert.match(catalog.stdout, /@webship\.co\/workspace-wordpress/);

    const ws = path.join(tmp, 'ws');
    const init = run(['init', ws]);
    assert.doesNotMatch(init.stderr, NO_TRACE);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.match(init.stdout, /@webship\.co\/workspace-/, 'init ends with the catalogue');
    for (const f of ['plugin-catalog.json', 'plugin-catalog.mts', 'server.js']) assert.ok(fs.existsSync(path.join(ws, 'core', 'workspace-app', f)), `the workspace has ${f}`);

    const update = run(['update', ws]);
    assert.doesNotMatch(update.stderr, NO_TRACE);
    assert.strictEqual(update.status, 0, update.stderr);

    // doctor ends with 1 on a machine that misses a command, which is not this test's matter: it must not fail on a
    // module. (The plugin steps run the workspace's own copy, with the dashboard's packages, which this test skips.)
    for (const [args, cwd] of [[['doctor'], tmp], [['doctor', ws], tmp], [['doctor'], ws]]) {
      const r = run(args, cwd);
      assert.doesNotMatch(r.stderr + r.stdout, NO_TRACE, `${args.join(' ')} in ${cwd === ws ? 'the workspace' : 'no workspace'}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the command loads no TypeScript file of the package', () => {
  for (const file of fs.readdirSync(path.join(REPO, 'core', 'bin')).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(REPO, 'core', 'bin', file), 'utf8');
    for (const line of src.split('\n')) {
      // What is loaded from the package itself (CORE_SRC, PKG_ROOT, or a file beside the command).
      if (!/require\((?:path\.join\((?:CORE_SRC|PKG_ROOT)|'\.)/.test(line)) continue;
      assert.doesNotMatch(line, /\.[mc]?ts['"]/, `${file}: ${line.trim()}`);
    }
  }
});

test('/tmp/.docksal is as this file found it: doctor checked no machine\'s workspace from /tmp (#772)', () => {
  assert.deepStrictEqual(projectOfTmp(), projectOfTmpAtStart);
});
