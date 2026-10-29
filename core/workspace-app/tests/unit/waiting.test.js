const { test } = require('node:test');
const assert = require('node:assert');
const { waitingState } = require('../../waiting');

// The real footer of a working Claude Code session, captured from a live run.
const BUSY = ['  Ran 1 shell command',
  '6 Thinking… (6m 16s · 23.9k tokens)',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'].join('\n');

test('the interrupt hint means working, whatever else is on screen', () => {
  assert.equal(waitingState(BUSY).waiting, false);
  // Even with a question ABOVE it: the footer is the authority.
  assert.equal(waitingState(`Do you want to proceed?\n❯ 1. Yes\n${BUSY}`).waiting, false);
});

test('a numbered choice with a caret is waiting', () => {
  const s = waitingState('Do you want to proceed?\n❯ 1. Yes\n  2. No');
  assert.equal(s.waiting, true);
  assert.match(s.why, /choice/);
});

test('yes/no in the shapes CLIs actually ask', () => {
  assert.equal(waitingState('Overwrite the file? (y/N)').waiting, true);
  assert.equal(waitingState('Continue [Y/n]').waiting, true);
});

test('an idle Claude prompt is flagged, more gently', () => {
  const s = waitingState('⏵⏵ bypass permissions on (shift+tab to cycle)\n? for shortcuts');
  assert.equal(s.waiting, true);
  assert.match(s.why, /idle/);
});

test('ordinary output is not a question', () => {
  assert.equal(waitingState('Ran 3 shell commands\nAll five components verified.').waiting, false);
  assert.equal(waitingState('').waiting, false);
  assert.equal(waitingState(null).waiting, false);
});

test('a report that merely mentions a question is not waiting', () => {
  // An agent writing prose about a question must not raise the flag.
  assert.equal(waitingState('The ticket asks: do you want the picker? I implemented it.\nRan 2 commands').waiting, false);
  assert.equal(waitingState('I asked whether to continue? and decided yes.\nMoving on.').waiting, false);
});

test('the question has to be the last thing on screen, not buried above', () => {
  const buried = ['Do you want to proceed?', 'yes', 'Ran 4 commands', 'Wrote 2 files', 'Done.'].join('\n');
  assert.equal(waitingState(buried).waiting, false);
});
