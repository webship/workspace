/**
 * The Docker-restart watcher.
 *
 * The boot service starts the dashboard once; a Docker restart afterwards stopped every container and nothing
 * started them again (workspace.ddev.site answered nothing until somebody noticed). The watcher remembers
 * when Docker last started and runs the start script once when that changes. It must never start anything
 * only because the dashboard is down: a dashboard stopped on purpose stays stopped.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '../../../scripts');
const WATCH = path.join(SCRIPTS, 'autostart-watch.sh');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-watch-'));
  const ran = path.join(dir, 'ran');
  const look = (stamp) => spawnSync('bash', [WATCH], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir, AUTOSTART_WATCH_STATE: path.join(dir, 'stamp'),
      AUTOSTART_WATCH_RUN: `echo RAN >> '${ran}'`, AUTOSTART_WATCH_DOCKER_STAMP: stamp },
  });
  const runs = () => (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8').trim().split('\n').length : 0);
  return { look, runs, dir };
}

test('the first look only remembers; a restart runs the start script once', () => {
  const s = sandbox();
  s.look('Wed 2026-10-14 10:51:26 +03');
  assert.strictEqual(s.runs(), 0, 'nothing is started just because it looked');
  s.look('Wed 2026-10-14 10:51:26 +03');
  assert.strictEqual(s.runs(), 0, 'the same Docker start is not a restart');
  const out = s.look('Wed 2026-10-14 14:02:00 +03');
  assert.strictEqual(s.runs(), 1);
  assert.match(out.stdout, /Docker restarted \(Wed 2026-10-14 10:51:26 \+03 -> Wed 2026-10-14 14:02:00 \+03\)/);
  s.look('Wed 2026-10-14 14:02:00 +03');
  assert.strictEqual(s.runs(), 1, 'and only once for that restart');
  s.look('Wed 2026-10-14 16:30:00 +03');
  assert.strictEqual(s.runs(), 2, 'a later restart is a new one');
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test('Docker not answering does nothing', () => {
  const s = sandbox();
  s.look('Wed 10:51');
  s.look('');
  assert.strictEqual(s.runs(), 0);
  assert.strictEqual(fs.readFileSync(path.join(s.dir, 'stamp'), 'utf8').trim(), 'Wed 10:51', 'and forgets nothing');
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test('a start that fails is not retried every two minutes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-watch-'));
  const ran = path.join(dir, 'ran');
  const look = (stamp) => spawnSync('bash', [WATCH], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir,
    AUTOSTART_WATCH_STATE: path.join(dir, 'stamp'), AUTOSTART_WATCH_RUN: `echo RAN >> '${ran}'; exit 1`, AUTOSTART_WATCH_DOCKER_STAMP: stamp } });
  look('A');
  look('B');
  look('B');
  look('B');
  assert.strictEqual(fs.readFileSync(ran, 'utf8').trim().split('\n').length, 1, 'one attempt for that restart, however it ended');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enable installs the timer and disable removes it', () => {
  const fn = fs.readFileSync(path.join(SCRIPTS, 'functions/fun-autostart.sh'), 'utf8');
  assert.match(fn, /function autostart_write_watch\(\)/);
  assert.match(fn, /OnUnitActiveSec=2min/);
  assert.match(fn, /systemctl --user enable --now "\$\{AUTOSTART_WATCH_NAME\}\.timer"/);
  assert.match(fn, /systemctl --user disable --now "\$\{AUTOSTART_WATCH_NAME\}\.timer"/);
});
