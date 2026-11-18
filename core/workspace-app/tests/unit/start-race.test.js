/**
 * One command, started once: identical requests at the same moment do not run it twice.
 *
 * Each start asked `screen -ls` and then started the session; two requests at one moment both found
 * nothing and both started. Six presses of one tool were six copies running at once. A `screen` stand-in
 * that takes a moment to start a session (as a busy machine does) and lists what it started.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-start-race-'));
fs.mkdirSync(path.join(root, 'core', 'config'), { recursive: true });
fs.writeFileSync(path.join(root, 'core', 'config', 'settings.yml'), 'workspaces: dev\n');
fs.mkdirSync(path.join(root, 'dev'), { recursive: true });
process.env.WORKSPACE_ROOT = root;
process.env.WORKSPACE_CONFIG = path.join(root, 'core', 'config');

const bin = path.join(root, 'bin');
const started = path.join(root, 'started.txt');
fs.mkdirSync(bin);
// screen(1): a start takes half a second and is then listed; -ls lists what was started.
fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in
  --version) echo "Screen version 4.09.01 (a stand-in)" ; exit 0 ;;
  -ls) [ -f ${JSON.stringify(started)} ] && sed 's/^/\\t4242./; s/$/\\t(Detached)/' ${JSON.stringify(started)} ; exit 0 ;;
esac
case " $* " in *" -dmS "*) sleep 0.5 ; for a; do [ "$prev" = "-dmS" ] && echo "$a" >> ${JSON.stringify(started)} ; prev="$a" ; done ;; esac
exit 0
`, { mode: 0o755 });
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const jobs = require('../../jobs');

test('six identical starts at once run the command once; the others are told it is running', async () => {
  const opts = { workspace: 'dev', project: 'site1', projectDir: path.join(root, 'dev'), verb: 'run', cmdLine: 'echo once', label: 'run' };
  const results = await Promise.all(Array.from({ length: 6 }, () => jobs.startInScreen(opts)));
  const ok = results.filter((r) => r.ok);
  const already = results.filter((r) => r.already);
  assert.strictEqual(ok.length, 1, JSON.stringify(results));
  assert.strictEqual(already.length, 5);
  assert.deepStrictEqual(fs.readFileSync(started, 'utf8').trim().split('\n'), ['dev--site1--run'], 'one session was started');
});

test('another project is not held up, and once a session has started the real list answers', async () => {
  fs.rmSync(started, { force: true });
  const opts = (project) => ({ workspace: 'dev', project, projectDir: path.join(root, 'dev'), verb: 'run', cmdLine: 'echo x', label: 'x' });
  const [a, other] = await Promise.all([jobs.startInScreen(opts('site2')), jobs.startInScreen(opts('site3'))]);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(other.ok, true, 'a different session starts at the same time');
  const again = await jobs.startInScreen(opts('site2'));
  assert.strictEqual(again.already, true, 'listed by screen -ls: running');
  fs.rmSync(started, { force: true });
  const after = await jobs.startInScreen(opts('site2'));
  assert.strictEqual(after.ok, true, 'gone from the list: it starts again');
});
