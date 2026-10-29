/**
 * The job fragment's two newer faces: the phase progress bar and inline mode.
 *
 * Both are rendered from the job record alone, so they can be tested by seeding
 * the registry directly — no process is spawned. The phase bar's one honesty
 * rule is tested from both sides: a phase counts only when its marker is in the
 * output, and a finished job reports full whatever the output said.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { jobs, jobFragment } = require('../../jobs');

function seed(id, job) {
  jobs.set(id, { title: 'T', key: null, phases: null, inline: false, buf: '', done: false, ok: null, ...job });
  return id;
}

test('a job without phases renders no progress bar', () => {
  const { html } = jobFragment(seed('t-plain', { buf: 'hello' }));
  assert.ok(!html.includes('job-progress'));
});

test('the phase bar counts only markers that actually appeared', () => {
  const phases = ['Exporting', 'Copying', 'Importing'];
  const { html } = jobFragment(seed('t-phases', { phases, buf: 'Exporting the db\nCopying files' }));
  assert.match(html, /value="2" max="3"/);
  // The label names the phase the run is ON, not one it finished.
  assert.ok(html.includes('Importing (2/3)'));
});

test('a finished successful job reports the bar full', () => {
  const { html } = jobFragment(seed('t-done', { phases: ['A', 'B'], buf: 'A', done: true, ok: true }));
  assert.match(html, /value="2" max="2"/);
  assert.ok(html.includes('Done (2/2)'));
});

test('inline jobs carry the class that keeps them out of the toast stack, and a done note', () => {
  const running = jobFragment(seed('t-inline', { inline: true, buf: 'x' })).html;
  assert.ok(running.includes('job-inline'));
  assert.ok(!running.includes('job-done-note'), 'no done note while running');
  const done = jobFragment(seed('t-inline-done', { inline: true, buf: 'x', done: true, ok: true })).html;
  assert.ok(done.includes('job-done-note'));
  assert.ok(done.includes('Done — the process finished'));
  const failed = jobFragment(seed('t-inline-fail', { inline: true, buf: 'x', done: true, ok: false })).html;
  assert.ok(failed.includes('The process failed'));
});

test('a non-inline job never renders the done note', () => {
  const { html } = jobFragment(seed('t-stack-done', { buf: 'x', done: true, ok: true }));
  assert.ok(!html.includes('job-done-note'));
});

const { screenWrap } = require('../../jobs');

test('screenWrap builds the detach-tail-wait line and refuses bad names', () => {
  const line = screenWrap({ session: 'jira-x-1', inner: 'echo hi', logFile: '/tmp/x.log' });
  assert.match(line, /screen -c "[^"]*\/screenrc" -dmS jira-x-1/,
    "under the dashboard's own screenrc, never the machine's");
  assert.ok(line.includes('tail -F "/tmp/x.log"'));
  // The waiter must match the session EXACTLY: a bare "[.]jira-x-1" also matches
  // jira-x-12, so a job would wait on the wrong session's lifetime.
  assert.ok(line.includes('grep -q "[.]jira-x-1[[:space:]]"'), 'the waiter dot-escapes and terminates the session name');
  assert.throws(() => screenWrap({ session: 'bad name; rm', inner: 'x', logFile: '/tmp/y' }));
});
