/**
 * The host screen runner's request queue (scripts/screen-runner.js). The queue is drained on a poll and on
 * every folder-watch event, and one new file fires the watch more than once, so two drains could read the
 * same request before its unlink landed: a burst of 12 start requests made 14 sessions. What must never
 * drift: a request is claimed by an atomic rename before it is read, and a session already being started
 * is not started again. The runner starts servers and timers when loaded, so this reads its source.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'screen-runner.js'), 'utf8');
const fn = src.slice(src.indexOf('function handleRequest(file) {'), src.indexOf('function drainQueue() {'));

test('a queued request is claimed with a rename before it is read, and a lost claim does nothing', () => {
  assert.ok(fn.length > 0, 'handleRequest was not found');
  const claim = fn.indexOf('fs.renameSync(file, claimed)');
  const read = fn.indexOf('fs.readFileSync(');
  assert.ok(claim > 0 && read > claim, 'the request must be renamed before it is read');
  assert.match(fn, /try \{ fs\.renameSync\(file, claimed\); \} catch \(_\) \{ return; \}/, 'a drain that loses the rename returns');
  assert.ok(!/fs\.readFileSync\(file,/.test(fn), 'the unclaimed file is never read');
  // A claimed file no longer ends in .json, so the next drain does not pick it up.
  assert.match(src, /filter\(\(f\) => f\.endsWith\('\.json'\)\)/);
});

test('a session already being started is answered "already", and the mark is cleared on every way out', () => {
  assert.match(src, /const starting = new Set\(\);/);
  assert.match(fn, /if \(starting\.has\(session\)\) return answer\(id, \{ ok: false, already: true \}\);\s*starting\.add\(session\);/);
  const ways = (fn.match(/starting\.delete\(session\)/g) || []).length;
  assert.ok(ways >= 3, `cleared when it already exists, when screen fails, and once it has started (found ${ways})`);
});

test('a session is started with no shell between the runner and screen, so its line is parsed once, in the session', () => {
  const runner = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'scripts', 'screen-runner.js'), 'utf8');
  assert.ok(!/execFile\('bash', \['-lc'/.test(runner), 'a bash -lc "…" wrapper expands $ and backticks on the host first');
  // -c first: every session this runner starts takes the dashboard's own screenrc (10k lines of
  // scrollback, alt-screen on, Ctrl-S as a keystroke), and never the machine's ~/.screenrc.
  assert.match(runner, /execFile\('screen', \['-c', SCREENRC, '-T', 'xterm-256color', '-dmS', session, 'bash', '-lc', inner\]/);
});
