/**
 * The host runner's list of sessions is never read half written.
 *
 * The runner rewrote `.screens/host-sessions.json` in place every two seconds, and the dashboard reads it to
 * know the runner is up. A read at that moment found an empty or half file, took the runner for down, and
 * the command was started in the dashboard's own screen instead (or refused, where there is none: a test
 * that faked the runner the same way failed now and then on a busy machine). Written beside and renamed now.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', '..');

test('the runner writes its list beside the old one and renames it over', () => {
  const src = fs.readFileSync(path.join(APP, 'scripts', 'screen-runner.js'), 'utf8');
  const publish = src.slice(src.indexOf('function publish()'), src.indexOf('function publish()') + 1200);
  assert.match(publish, /const tmp = `\$\{file\}\.\$\{process\.pid\}\.tmp`;/);
  assert.match(publish, /fs\.writeFileSync\(tmp, JSON\.stringify\(\{ at: Date\.now\(\)/);
  assert.match(publish, /fs\.renameSync\(tmp, file\);/);
  assert.doesNotMatch(src, /fs\.writeFileSync\(path\.join\(STORE, 'host-sessions\.json'\)/, 'never written in place');
});

test('a list rewritten that way, as fast as a machine can, always reads as a runner that is up', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-runner-list-'));
  fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces: dev\n');
  fs.mkdirSync(path.join(root, '.screens'), { recursive: true });
  process.env.WORKSPACE_ROOT = root;
  process.env.WORKSPACE_CONFIG = path.join(root, 'core', 'config');
  const file = path.join(root, '.screens', 'host-sessions.json');
  const rows = Array.from({ length: 40 }, (_, i) => ({ session: `dev--site${i}--build`, waiting: false }));
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), host: 'test', sessions: rows }));
  const writer = spawn(process.execPath, ['-e', `
    const fs = require('fs');
    const file = ${JSON.stringify(file)};
    const rows = ${JSON.stringify(rows)};
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      fs.writeFileSync(file + '.' + process.pid + '.tmp', JSON.stringify({ at: Date.now(), host: 'test', sessions: rows }));
      fs.renameSync(file + '.' + process.pid + '.tmp', file);
    }
  `], { stdio: 'ignore' });
  const { hostSessionsFile } = require('../../jobs');
  let reads = 0;
  let down = 0;
  const done = new Promise((resolve) => writer.on('exit', resolve));
  let finished = false;
  done.then(() => { finished = true; });
  while (!finished) {
    reads += 1;
    if (!hostSessionsFile()) down += 1;
    await new Promise((r) => { setImmediate(r); });
  }
  assert.ok(reads > 100, `read ${reads} times`);
  assert.strictEqual(down, 0, `the runner read as down ${down} times of ${reads}`);
  fs.rmSync(root, { recursive: true, force: true });
});
