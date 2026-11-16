/**
 * plugins.sh restarts the dashboard after a step, so it loads the change. The dashboard container
 * (ddev-workspace-web) belongs to ONE workspace: a second workspace on the same machine must never
 * restart it. These checks drive `plugins.sh --restart` with stand-ins for docker and supervisorctl
 * first on PATH, so nothing here reaches a real container.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');

/** A bin folder with a docker and a supervisorctl that write what they were asked to a log. */
function standIns({ mountSource = '', containerUp = true, supervised = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-restart-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
echo "docker $*" >> "${log}"
if [ "$1" == 'inspect' ] ; then
  [ "${containerUp ? 'yes' : 'no'}" == 'yes' ] || exit 1
  case "$*" in *--format*) echo "${mountSource}" ;; esac
  exit 0
fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'supervisorctl'), `#!/usr/bin/env bash
echo "supervisorctl $*" >> "${log}"
[ "${supervised ? 'yes' : 'no'}" == 'yes' ] || exit 1
exit 0
`, { mode: 0o755 });
  return { root, bin, log };
}

function restart(t, extra = {}) {
  const env = { ...process.env, PATH: `${t.bin}:${process.env.PATH}`, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_ROOT: t.root, ...extra };
  delete env.WORKSPACE_PLUGINS_NO_RESTART;
  delete env.WORKSPACE_DASHBOARD_CONTAINER;
  if (!('DDEV_APPROOT' in extra)) delete env.DDEV_APPROOT;
  const r = spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--restart'], { cwd: t.root, env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  let calls = '';
  try { calls = fs.readFileSync(t.log, 'utf8'); } catch (_) { /* nothing was called */ }
  return { ...r, calls };
}

test('on the machine: the container of another workspace is never restarted', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-other-'));
  fs.mkdirSync(path.join(other, '.ddev'));
  const t = standIns({ mountSource: path.join(other, '.ddev') });
  const r = restart(t);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /docker exec/, 'no docker exec may reach a container that serves another workspace');
  assert.match(r.stdout, /serves another workspace: it is left alone/);
});

test('on the machine: the container that serves this app is restarted', () => {
  const t = standIns({ mountSource: path.join(APP, '.ddev') });
  const r = restart(t);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.calls, /docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app/);
});

test('on the machine: no container at all says so and restarts nothing', () => {
  const t = standIns({ containerUp: false });
  const r = restart(t);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /docker exec/);
  assert.match(r.stdout, /The dashboard is not running/);
});

test('in the container: a workspace that is not the one it serves leaves the app running', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-other-'));
  const t = standIns({ supervised: true });
  const r = restart(t, { DDEV_APPROOT: other });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /supervisorctl restart/);
  assert.match(r.stdout, /serves another workspace: it is left alone/);
});

test('in the container: the workspace it serves restarts the app', () => {
  const t = standIns({ supervised: true });
  const r = restart(t, { DDEV_APPROOT: APP });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.calls, /supervisorctl restart webextradaemons:workspace-app/);
});

test('WORKSPACE_PLUGINS_NO_RESTART still switches every restart off', () => {
  const t = standIns({ mountSource: path.join(APP, '.ddev') });
  const r = restart(t, { WORKSPACE_PLUGINS_NO_RESTART_TEST: '1' });
  assert.match(r.calls, /docker exec/);
  const env = { ...process.env, PATH: `${t.bin}:${process.env.PATH}`, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_ROOT: t.root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  fs.writeFileSync(t.log, '');
  const off = spawnSync('bash', [path.join(SCRIPTS, 'plugins.sh'), '--restart'], { cwd: t.root, env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(off.status, 0, off.stderr);
  assert.strictEqual(fs.readFileSync(t.log, 'utf8'), '');
});
