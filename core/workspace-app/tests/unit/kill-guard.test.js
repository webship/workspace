/**
 * The guard against `kill -- -1` in the dashboard's web container (webship/workspace#564).
 *
 * That container shared the machine's process space (`pid: host`, docker-compose.screens.yaml), and DDEV ends a web
 * container's processes with `kill -- -1`: there it reached processes outside the container. It has a process space
 * of its own now (the host runner does every screen verb, #591), and every bash in it still loads
 * workspace-kill-guard.sh (BASH_ENV), which refuses -1 as a target and passes every other kill on: harmless there, and
 * the protection of a container made from an older compose file, which mounts the same file.
 *
 * SAFETY: nothing here may ever send a real signal to -1. The script replaces bash's `builtin` with a stub BEFORE it
 * loads the guard, so the guard's pass-through only prints; and it checks that the stub and the guard are both in place
 * (with `kill -0`, which signals nothing) before it tries a single -1, and stops if either is missing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DDEV = path.join(__dirname, '..', '..', '.ddev');
const GUARD = path.join(DDEV, 'workspace-kill-guard.sh');

/** Runs `lines` (one kill per line) through the guard with a stubbed builtin. */
function guarded(lines) {
  const script = `
builtin() { echo "PASSED $*"; }
source ${JSON.stringify(GUARD)}
[ "$(type -t kill)" = function ] || { echo "GUARD NOT LOADED"; exit 3; }
[ "$(kill -0 $$)" = "PASSED kill -0 $$" ] || { echo "STUB NOT ACTIVE"; exit 3; }
${lines.map((l) => `${l}; echo "rc=$?"`).join('\n')}
`;
  const r = spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notStrictEqual(r.status, 3, r.stdout + r.stderr);
  return r;
}

test('every way of aiming at -1 is refused, with a reason, and nothing passes through', () => {
  const cases = ['kill -- -1', 'kill -TERM -1', 'kill -s TERM -1', 'kill -9 -- -1', 'kill -n 15 -1', 'kill -KILL 4321 -1'];
  const r = guarded(cases);
  assert.strictEqual((r.stdout.match(/^rc=1$/gm) || []).length, cases.length, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /PASSED kill .*-1\b(?!\d)/, 'no -1 reached the real kill');
  assert.strictEqual((r.stderr.match(/not signalling every process \(-1\) from the dashboard's web container: from the machine's process space it reaches the other containers/g) || []).length, cases.length);
});

test('every other kill passes through as it was written, -1 as a signal (SIGHUP) included', () => {
  const r = guarded(['kill -1 1234', 'kill -- 4321', 'kill -TERM 4321', 'kill -s HUP 4321', 'kill -l']);
  for (const line of ['PASSED kill -1 1234', 'PASSED kill -- 4321', 'PASSED kill -TERM 4321', 'PASSED kill -s HUP 4321', 'PASSED kill -l']) {
    assert.match(r.stdout, new RegExp(`^${line.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}$`, 'm'), r.stdout);
  }
  assert.strictEqual(r.stderr, '');
});

test('the guard takes the place of DDEV\'s own BASH_ENV, so it loads that first, and nothing in it replaces the guard', () => {
  // DDEV's /etc/bash.nointeractive.bashrc puts ~/bin, /var/www/html/bin and its in-container commands on the PATH of
  // every non-interactive bash, and sources ~/.bashrc.d. Setting BASH_ENV to the guard dropped all of that. Here the
  // guard is run with a stand-in for DDEV's file, one that also defines a kill of its own.
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-guard-ddev-'));
  try {
    const ddev = path.join(dir, 'bash.nointeractive.bashrc');
    fs.writeFileSync(ddev, 'export PATH="/var/www/html/bin:$PATH"\nkill() { echo "DDEV KILL"; }\n');
    const copy = path.join(dir, 'guard.sh');
    const text = fs.readFileSync(GUARD, 'utf8');
    assert.ok(text.includes('. /etc/bash.nointeractive.bashrc'), 'the guard loads DDEV\'s file');
    fs.writeFileSync(copy, text.split('/etc/bash.nointeractive.bashrc').join(ddev));
    // The same safety as above: the stub and the guard are both checked, with kill -0 (which signals nothing), before a
    // single -1 is tried, and the script stops if either is missing.
    const script = `builtin() { echo "PASSED $*"; }
source ${JSON.stringify(copy)}
[ "$(type -t kill)" = function ] || { echo "GUARD NOT LOADED"; exit 3; }
[ "$(kill -0 $$)" = "PASSED kill -0 $$" ] || { echo "NOT THE GUARD, OR THE STUB NOT ACTIVE: $(kill -0 $$)"; exit 3; }
case ":$PATH:" in *:/var/www/html/bin:*) echo "DDEV PATH" ;; esac
kill -- -1; echo "rc=$?"`;
    const r = spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.notStrictEqual(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /^DDEV PATH$/m, 'what DDEV puts on the PATH is there');
    assert.match(r.stdout, /^rc=1$/m, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /DDEV KILL|PASSED kill/, 'the guard is the kill, and it refused');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the dashboard\'s web container has a process space of its own, and still loads the guard in every bash', () => {
  const compose = fs.readFileSync(path.join(DDEV, 'docker-compose.screens.yaml'), 'utf8');
  const config = compose.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  // Neither the machine's process space nor screen's socket directory: the host runner reaches the sessions (#591).
  assert.doesNotMatch(config, /^\s*pid:/m, 'no pid: — the default, a process space of its own');
  assert.doesNotMatch(config, /\/run\/screen/, 'no /run/screen from the machine: screen in here keeps its own sessions');
  assert.match(compose, /- BASH_ENV=\/etc\/workspace-kill-guard\.sh/);
  assert.match(compose, /- "\$\{DDEV_APPROOT\}\/\.ddev\/workspace-kill-guard\.sh:\/etc\/workspace-kill-guard\.sh:ro"/);
  assert.ok(fs.existsSync(GUARD));
});

test('after a .ddev change the updater gives the restart that does not run DDEV\'s kill: docker kill, then ddev start', () => {
  const update = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'update.sh'), 'utf8');
  const block = update.slice(update.indexOf('if [ "${ddev_changed}" = "yes" ]; then'), update.indexOf('else', update.indexOf('if [ "${ddev_changed}" = "yes" ]; then')));
  assert.match(block, /docker kill ddev-\$\{project_name:-workspace\}-web && cd \$\{APP_DIR\} && ddev start/);
  assert.doesNotMatch(block, /echo "\s+cd \$\{APP_DIR\} && ddev restart"/);
});

test('after a .ddev change the command line\'s update says the same restart, and says nothing when .ddev is unchanged', () => {
  const os = require('os');
  const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'workspace.js');
  const env = { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '' };
  const cli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ddev-note-')), 'workspace');
  try {
    assert.strictEqual(cli('init', dir).status, 0);
    const app = path.join(dir, 'core', 'workspace-app');
    const note = `.ddev/ changed in this release. If the dashboard was running, restart it this way to take it (not ddev restart):  docker kill ddev-workspace-web && cd ${app} && ddev start`;
    assert.ok(!cli('update', dir).stdout.includes('.ddev/ changed'), 'the same release again: nothing to restart');
    // The record of the last copy says the compose file was another one: an older release's.
    const record = path.join(dir, 'core', '.shipped-files');
    fs.writeFileSync(record, fs.readFileSync(record, 'utf8').replace(/^[0-9a-f]{64}(  core\/workspace-app\/\.ddev\/docker-compose\.screens\.yaml)$/m, `${'0'.repeat(64)}$1`));
    const r = cli('update', dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(note), r.stdout);
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});
