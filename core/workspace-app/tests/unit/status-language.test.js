/**
 * Status chips say what they mean.
 *
 * Found by the local webship-ai-ux-designer agent reviewing the live pages: an agent that had stopped to ask a
 * question was labelled "agent running", the same words as one that was working (the difference was an amber
 * colour, an emoji and a tooltip); a Stopped site took the same brand blue as the agent chip and was the loudest
 * chip on its card; an attached session took the same amber as "waiting for you".
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const server = read('server.js');
const screens = read('screens.js');
const css = read('public/css/components/project-rows.css');

test('the agent chip says working, or waiting for you, in words', () => {
  assert.match(server, /\$\{agentWaiting \? 'waiting for you' : 'agent working'\}/);
  assert.ok(!/agent running\$\{/.test(server), 'the chip no longer says running');
  assert.match(server, /agent working<\/span> ` : ''/, 'and neither does the same chip on the Jira page');
});

test('the toolbar says how many are waiting, not only a hand', () => {
  assert.match(server, /">✋ \$\{waiting\.length\} waiting<\/span>`/);
});

test('a stopped site is a quiet outline, a running one is green, and the dot is drawn by CSS', () => {
  assert.match(server, /running: 'Running', paused: 'Paused', stopped: 'Stopped'/);
  assert.match(server, /st === 'running' \? 'uk-label-success' : `state-chip-off state-chip-\$\{st\}`/);
  assert.match(server, /<span class="state-dot" aria-hidden="true"><\/span><span class="state-word">/);
  assert.ok(!/🟢 Running|⚪ \$\{/.test(server), 'no emoji: each machine draws them differently');
  assert.match(css, /\.uk-label\.state-chip-off \{\s*background: transparent;\s*color: var\(--text-subtle\);\s*border: 1px solid var\(--line\);/);
});

test('on Screens, waiting names what it waits for, and an attached session is not amber', () => {
  assert.match(screens, /✋ Waiting for you · \$\{esc\(ask\)\}/);
  assert.match(screens, /replace\(\/\^waiting \(on\|for\) \/, ''\)/);
  assert.match(screens, /attached \? 'screen-state-attached' : 'uk-label-success'/);
  assert.match(css, /\.uk-label\.screen-state-attached \{\s*background: transparent;/);
});

test('the button that removes ended sessions says so', () => {
  assert.match(screens, /Remove ended sessions<\/button>/);
  assert.ok(!/Wipe dead<\/button>/.test(screens));
});
