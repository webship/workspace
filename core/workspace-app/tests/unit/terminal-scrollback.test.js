/**
 * Scrolling back in a terminal window.
 *
 * This looked impossible for a while, and the reason is worth keeping written down: the obvious
 * implementation defeats itself. `Ctrl-A Esc` opens screen's copy mode, and then an ARROW KEY closes
 * it again — the arrow sequence starts with Esc, and Esc in copy mode means abort — so the gesture
 * opens and closes copy mode in one motion and types the rest of the sequence into the shell. The
 * first attempt at this shipped that behaviour for a few minutes and was reverted: a window that
 * appears to scroll and instead types into your session is worse than one that does not scroll.
 *
 * What works is screen's own movement keys, which are plain characters.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(path.join(__dirname, '../../public/terminal.js'), 'utf8');
const screens = fs.readFileSync(path.join(__dirname, '../../screens.js'), 'utf8');

test('xterm keeps no scrollback of its own, and says why', () => {
  // screen holds its client on the alternate buffer whatever runs inside it, so nothing ever scrolls
  // off into xterm: a buffer here would hold nothing and cost memory.
  assert.match(client, /scrollback: 0,/);
  assert.match(client, /ALTERNATE buffer/);
  assert.match(client, /baseY stays 0/, 'measured, not assumed');
});

test('copy mode is entered with Ctrl-A then Esc', () => {
  assert.match(client, /const enterCopyMode = \(\) => \{ send\(String\.fromCharCode\(1\)\); send\(String\.fromCharCode\(27\)\); \};/);
});

test('the wheel moves with screen\'s own keys, never with an arrow', () => {
  // The whole bug: an arrow starts with Esc, and Esc in copy mode aborts.
  assert.match(client, /const HALF_UP = String\.fromCharCode\(21\);/, 'Ctrl-U');
  assert.match(client, /const HALF_DOWN = String\.fromCharCode\(4\);/, 'Ctrl-D');
  const wheel = client.slice(client.indexOf("el.addEventListener('wheel'"), client.indexOf('{ capture: true, passive: false }'));
  assert.doesNotMatch(wheel, /\\x1b\[A|\\x1b\[B/, 'no arrow sequences reach a session in copy mode');
  assert.match(client, /An ARROW KEY ABORTS IT/, 'and the reason is written where the next person will look');
});

test('only scrolling UP opens copy mode', () => {
  // There is nothing below the last line to reach, so a wheel-down at the bottom must not open it.
  const wheel = client.slice(client.indexOf("el.addEventListener('wheel'"), client.indexOf('{ capture: true, passive: false }'));
  assert.match(wheel, /if \(e\.deltaY < 0\) enterCopyMode\(\);/);
});

test('whether it is in copy mode is SCREEN\'s answer, not a hopeful flag', () => {
  // The first version set the flag when it sent the keys, and was wrong whenever copy mode did not
  // open — and then every wheel notch typed into the shell.
  assert.match(client, /if \(\/Copy mode aborted\/\.test\(text\)\) \{/);
  assert.match(client, /\} else if \(\/Copy mode\/\.test\(text\)\) \{/);
  assert.match(client, /never a\s*\n?\s*\/\/ flag set hopefully/);
});

test('there is a button as well as a wheel', () => {
  assert.match(screens, /term-scrollback/);
  assert.match(client, /const back = e\.target\.closest\('\.term-scrollback'\);/);
  assert.match(client, /win\.__scrollBack\(\)/);
});
