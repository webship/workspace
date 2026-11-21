/**
 * The guard against `kill -- -1` in the dashboard's web container (webship/workspace#564).
 *
 * That container shares the machine's process space (`pid: host`, docker-compose.screens.yaml), and DDEV ends a web
 * container's processes with `kill -- -1`: there it would reach processes outside the container. Every bash in the
 * container loads workspace-kill-guard.sh (BASH_ENV), which refuses -1 as a target and passes every other kill on.
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
  assert.strictEqual((r.stderr.match(/not signalling every process \(-1\): this container shares the machine's process space/g) || []).length, cases.length);
});

test('every other kill passes through as it was written, -1 as a signal (SIGHUP) included', () => {
  const r = guarded(['kill -1 1234', 'kill -- 4321', 'kill -TERM 4321', 'kill -s HUP 4321', 'kill -l']);
  for (const line of ['PASSED kill -1 1234', 'PASSED kill -- 4321', 'PASSED kill -TERM 4321', 'PASSED kill -s HUP 4321', 'PASSED kill -l']) {
    assert.match(r.stdout, new RegExp(`^${line.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}$`, 'm'), r.stdout);
  }
  assert.strictEqual(r.stderr, '');
});

test('the dashboard\'s web container loads the guard in every bash, from the file next to it', () => {
  const compose = fs.readFileSync(path.join(DDEV, 'docker-compose.screens.yaml'), 'utf8');
  assert.match(compose, /pid: "host"/);
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
