/**
 * A screen that has stopped to ask you something raises its hand, and an agent at work says so.
 *
 * The point of a detached session is that nobody is watching it, so a question nobody sees is a run
 * that is not happening. Two things had to be true for the hand to be worth having, and each cost a
 * round of debugging:
 *
 *   - it has to go DOWN again. An answered `(y/n)` went on matching, because the rule allows a few
 *     characters after the bracket for a cursor and a typed `y` is one of them — so the hand stayed up
 *     for the rest of the session's life, which trains you to ignore it;
 *   - the agent answer has to be per PROJECT. The first version cached the computed set rather than
 *     the process snapshot it came from, so on a workspace of eleven projects, ten of them claimed the
 *     first one's agent.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { waitingState } = require('../../waiting');
const { sessionWaitingWhy, agentSessions } = require('../../screens');
const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const screensSrc = fs.readFileSync(path.join(__dirname, '../../screens.js'), 'utf8');

test('an ANSWERED question is not a question', () => {
  const asked = 'rajab@host:~$ read -p x\nDo you want to continue? (y/n) ';
  const answered = 'Do you want to continue? (y/n) y\nrajab@host:~/workspace/test/ruverify1$';
  assert.equal(waitingState(asked).waiting, true);
  assert.equal(waitingState(answered).waiting, false,
    'the shell has moved on; the hand has to go down or it is noise');
});

test('a cursor after the bracket is still a question', () => {
  // Which is what the allowance was for — the fix must not take it away.
  assert.equal(waitingState('Overwrite the file? (y/N) _').waiting, true);
  assert.equal(waitingState('Overwrite the file? (y/N) ').waiting, true);
});

test('the rules that are drawn with a footer keep their three-line window', () => {
  // A numbered choice and a "press Enter" have a footer under them, so they are not the last line.
  assert.equal(waitingState('❯ 1. Yes\n  2. No\n  ? for shortcuts').waiting, true);
  assert.equal(waitingState('Press Enter to continue\n⏵⏵ bypass permissions on').waiting, true);
});

test('busy is not waiting, whatever else is on the screen', () => {
  const busy = '6 Thinking… (6m 16s · 23.9k tokens)\n⏵⏵ bypass permissions on · esc to interrupt';
  assert.equal(waitingState(busy).waiting, false, 'the interrupt hint means it is working');
});

test('the runner\'s reading of the visible screen wins over the log', () => {
  // A Claude Code session writes no log at all — `exec claude` with no tee — so the log check can never
  // fire for exactly the sessions where a question matters most.
  assert.equal(sessionWaitingWhy({ session: 'nope', waiting: true, waitingWhy: 'waiting on a choice' }),
    'waiting on a choice');
  assert.equal(sessionWaitingWhy({ session: 'nope', waiting: true }), 'waiting for you',
    'a runner that says waiting without a reason still raises the hand');
  assert.equal(sessionWaitingWhy(null), '');
});

test('agentSessions answers per session, never from a cached answer', () => {
  // The bug this pins: caching the computed set meant the second project asked within five seconds got
  // the first project's agents back. Ten rows of eleven claimed an agent that was not theirs.
  assert.deepEqual([...agentSessions([])], [], 'no sessions, no agents');
  assert.deepEqual([...agentSessions([{ session: 'x', pid: '0' }])], [],
    'pid 0 is every top-level process: walking from it would claim every agent on the machine');
  assert.deepEqual([...agentSessions([{ session: 'x' }])], [], 'a row with no pid claims nothing');
  // The snapshot is what is memoised.
  assert.match(screensSrc, /function processTable\(\)/);
  assert.match(screensSrc, /psMemo = \{ at: now, kids, args \}/);
  assert.doesNotMatch(screensSrc, /agentMemo/, 'the ANSWER is never cached');
});

test('the row states both at the right-hand end of its name line', () => {
  // One glance answers "is anything happening here, and is the site up". Split to opposite ends, the
  // eye had to cross the name to collect one of the two.
  const line = server.slice(server.indexOf('<div class="pcard-head">'));
  const block = line.slice(0, line.indexOf('</div>', line.indexOf('project-title-status')));
  assert.match(block, /class="project-title-status pcard-status"/);
  // The agent first, then what DDEV says — so the running state keeps the far right, where it was.
  assert.ok(block.indexOf('project-title-agent') < block.indexOf('project-title-state'),
    'the agent sits next to the running state, not past it');
  assert.match(server, /hx-swap-oob="true"/, 'the agent badge is filled by the poll the row already makes');
});

test('the hand and the agent badge are sent even when empty', () => {
  // An out-of-band swap that is only sent sometimes leaves the last answer standing after the question
  // has been answered or the agent has finished.
  const frag = server.slice(server.indexOf('const hand = `<span class="screens-hand'));
  assert.match(frag, /waiting\.length \? `✋/, 'the hand is conditional INSIDE the span, not around it');
  assert.match(frag, /agents\.size\s*\n?\s*\? `<span class="uk-label/, 'and so is the badge');
});

test('both badges are the same pill, in different colours', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/components/mic-on-any-field-that-wants-typing.css'), 'utf8');
  const rows = fs.readFileSync(path.join(__dirname, '../../public/css/components/project-rows.css'), 'utf8');
  // The pill rule names the WRAPPER, so a badge that joins the line later is the same shape by
  // construction. Scoped to .project-title-state alone, the agent badge fell back to bare UIkit — a
  // 2px corner, 21px tall, UPPERCASE — next to a 26px pill, which reads as one of the two being broken.
  assert.match(css, /\.project-title-status \.uk-label,\s*\n\s*\.project-title-state \.uk-label/);
  // Different colours, because they answer different questions: green is "the site is up", brand blue
  // is "something is working on it". Two green pills say one thing twice.
  assert.match(rows, /\.project-title-status \.agent-live \{[^}]*background: var\(--brand-primary\)/s);
  // And amber still wins when it has stopped to ask you something — the one state worth shouting.
  assert.match(rows, /\.project-title-status \.agent-live\.uk-label-warning \{[^}]*var\(--warning\)/s);
});

test('a CLI session is offered as an id to resume, never as a link', () => {
  // A Claude Code CLI session is a transcript in ~/.claude/projects on this machine. It has no page on
  // claude.ai — the claude.ai/code ids that turn up inside transcripts belong to cloud sessions — so a
  // link would either go nowhere or suggest the conversation is on the web when it is not. These are
  // client projects: the id is something to resume with, never to publish.
  assert.match(screensSrc, /claude --resume \$\{esc\(latest\.id\)\}/);
  assert.doesNotMatch(screensSrc, /claude\.ai\/code\/session/, 'no link to a page that does not exist');
  assert.match(screensSrc, /it has no page on claude\.ai/, 'and it says so where somebody would look for one');
  // The NEWEST session for the folder, said as that: a screen started with `exec claude` does not
  // record which conversation it ended up in.
  assert.match(screensSrc, /the newest\s*\n?\s*Claude Code session in this folder/);
});

test('the robot is an icon from the sprite, not an emoji', () => {
  // An emoji is drawn by the platform's own font: a grey outline on one machine, a yellow cartoon on
  // another, at a size and weight nothing here controls. robot-face over robot because at the 14px a
  // label gives it, a whole robot is a smudge — compared side by side at badge size.
  assert.match(server, /iconHtml\('tabler:robot-face', 0\.8\)/);
  // Scoped to the badges, not to the file: the three runJob labels that say an AI wrote the job are a
  // different thing, and a blanket search would have this test fail on one of those instead.
  assert.doesNotMatch(server, /🤖 agent running/, 'the badge is an icon now, here and on the Jira page');
});
