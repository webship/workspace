/**
 * The host screen runner keeps the code it was started with, so an update restarts it (webship/workspace#591).
 *
 * The dashboard asks the runner for the verbs on the sessions on the machine (stuff, detach, wipe), which a runner
 * started from an older release does not know: until it is restarted, those answer "from an older release". So
 * `screen-host.sh --restart` stops it and starts it again (the sessions keep running), and both updaters do that for a
 * running runner when a release changed it. Run against a copy of the runner in a temp tree, with a stand-in `screen`;
 * the only process signalled is the runner it started, by the pid in its own pid file.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (_) { return false; } };

test('--restart stops the runner and starts it again, on a new pid, and --stop ends it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-host-restart-'));
  const app = path.join(root, 'core', 'workspace-app');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  for (const f of ['scripts/screen-host.sh', 'scripts/screen-runner.js', 'waiting.mts', 'session-env.mts', 'host-processes.mts', 'screenrc']) {
    fs.copyFileSync(path.join(APP, f), path.join(app, f));
  }
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(app, 'node_modules'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'screen'), '#!/bin/sh\n[ "$1" = "-ls" ] && { echo "No Sockets found in /tmp/s."; exit 1; }\nexit 0\n', { mode: 0o755 });
  const port = String(await free());
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SCREEN_RUNNER_BIND: '127.0.0.1' };
  const host = (...args) => spawnSync('bash', [path.join(app, 'scripts', 'screen-host.sh'), ...args, '--port', port], { encoding: 'utf8', env });
  const pidFile = path.join(root, '.screens', '.runner-pid');
  const pidOf = () => fs.readFileSync(pidFile, 'utf8').trim();
  let first = '';
  let second = '';
  try {
    assert.match(host('--start').stdout, /Started the screen runner/);
    first = pidOf();
    assert.ok(alive(first));
    const r = host('--restart');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`Stopped the runner \\(pid ${first}\\)\\. The sessions it started keep running\\.`));
    assert.match(r.stdout, /Started the screen runner/);
    second = pidOf();
    assert.notStrictEqual(second, first, 'a new runner, on this release\'s code');
    for (let t = 0; t < 30 && alive(first); t += 1) await wait(100);
    assert.ok(!alive(first), 'the old one is gone');
    assert.ok(alive(second));
    assert.match(host('--status').stdout, new RegExp(`^Running — pid ${second}`, 'm'));
    assert.match(host('--stop').stdout, /Stopped the runner/);
    for (let t = 0; t < 30 && alive(second); t += 1) await wait(100);
    assert.ok(!alive(second));
  } finally {
    // Whatever an assertion left running: the runners this test started, by their own pids.
    for (const p of [first, second]) if (p && alive(p)) process.kill(Number(p), 'SIGTERM');
    await wait(200);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('both updaters restart a running runner that the release changed, and only then', () => {
  const update = fs.readFileSync(path.join(APP, 'scripts', 'update.sh'), 'utf8');
  // What the runner loads: a change to any of them is a change to the runner.
  assert.match(update, /for f in scripts\/screen-runner\.js host-processes\.mts waiting\.mts session-env\.mts; do/);
  assert.match(update, /cmp -s "\$\{extracted\}\/core\/workspace-app\/\$\{f\}" "\$\{APP_DIR\}\/\$\{f\}" \|\| runner_changed="yes"/);
  assert.match(update, /if \[ "\$\{runner_changed\}" = "yes" \] && bash "\$\{APP_DIR\}\/scripts\/screen-host\.sh" --status 2>\/dev\/null \| grep -q '\^Running'; then/);
  assert.match(update, /bash "\$\{APP_DIR\}\/scripts\/screen-host\.sh" --restart/);
  // After the dry run and the prompts-only exits: a check changes nothing.
  assert.ok(update.indexOf('runner_changed}" = "yes" ] &&') > update.indexOf('(dry run — nothing was changed)'));
  const cli = fs.readFileSync(path.join(REPO, 'core', 'bin', 'workspace.js'), 'utf8');
  assert.match(cli, /\['scripts\/screen-runner\.js', 'host-processes\.mts', 'waiting\.mts', 'session-env\.mts'\]/);
  assert.match(cli, /shippedBefore\[f\] !== shipped\.get\(f\)/, 'only when this release changed it');
  assert.match(cli, /spawnSync\('bash', \[host, '--restart'\]/);
});

test('the runner refuses a Node.js too old to strip the types of what it loads, and says which it needs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-host-node-'));
  const app = path.join(root, 'core', 'workspace-app');
  fs.mkdirSync(path.join(app, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(APP, 'scripts', 'screen-host.sh'), path.join(app, 'scripts', 'screen-host.sh'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'screen'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  // A Node.js 22: it answers its version and runs the check, which says no.
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n[ "$1" = "--version" ] && { echo v22.20.0; exit 0; }\n[ "$1" = "-e" ] && exit 1\nexit 0\n', { mode: 0o755 });
  const r = spawnSync('bash', [path.join(app, 'scripts', 'screen-host.sh'), '--start'], { encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`, WORKSPACE_ROOT: root } });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /node v22\.20\.0 is too old for the runner: it needs Node\.js 24 or later\./);
  assert.ok(!fs.existsSync(path.join(root, '.screens', '.runner-pid')), 'nothing was started');
  // And the script's own check passes on this Node.js, which runs the suite.
  const check = fs.readFileSync(path.join(APP, 'scripts', 'screen-host.sh'), 'utf8').match(/node -e '([^']+)'/)[1];
  const here = spawnSync(process.execPath, ['-e', check]);
  assert.strictEqual(here.status, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
