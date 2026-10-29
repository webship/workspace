/**
 * How big a terminal window opens, and what happens when it is resized.
 *
 * Three faults, each of which made the window show the wrong thing rather than merely look wrong:
 *
 *   1. **It opened too narrow.** The default was `innerWidth * 0.52` capped at 860px, which on a
 *      1100px screen is 572px — 70 columns. 80x24 is what every TUI assumes, so everything inside
 *      folded, and wrapped output reads as a broken program rather than as a small window.
 *   2. **A resize did not reach the session.** The PTY is sized once, by the `stty` the server runs
 *      before `screen -x`, and every socket message goes to the session's stdin — so there is no
 *      resize channel to use. xterm re-fitted locally while screen went on painting for the old width.
 *   3. **Attaches leaked.** `SIGHUP` to `script` left the `screen -x` client behind, one per window
 *      and then one per resize — and screen fits a window to EVERY attached display, so a pile of
 *      stale clients pins the session to the smallest one and the size can never be corrected.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(path.join(__dirname, '../../public/terminal.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const screens = fs.readFileSync(path.join(__dirname, '../../screens.js'), 'utf8');

test('the sizes offered are the ones the Ubuntu terminal offers', () => {
  // A terminal is measured in columns and rows: 132x43 means something to anyone who has used one,
  // and "1057 by 741" means nothing. These four are GNOME/Ubuntu's own profile presets, so the list
  // is familiar rather than invented here.
  assert.match(client, /const PRESETS = \[\s*\{ cols: 80, rows: 24 \},\s*\{ cols: 80, rows: 43 \},\s*\{ cols: 132, rows: 24 \},\s*\{ cols: 132, rows: 43 \},/);
  // The menu is one loop over the same four, so assert the LIST and the template rather than the
  // rendered strings — matching my own interpolation would test nothing.
  assert.match(screens, /\[\[80, 24\], \[80, 43\], \[132, 24\], \[132, 43\]\]/);
  assert.match(screens, /data-term-size="\$\{c\}x\$\{r\}"/);
  assert.match(screens, /data-term-size="fit"/, 'and the default, said in words');
});

test('a window opens at 132x43, clamped to the display', () => {
  // 80x24 is the floor, not the default — it is cramped for a build log or an agent's output, which is
  // most of what these windows hold. And NOT "the biggest that fits", which was tidy and wrong: the
  // window is draggable and resizable, so a few pixels past the edge is something you move, while a
  // terminal that opened too small is something you have to notice and correct. Measured: 1700x1000
  // opens 132x43 and 1100x800 clamps to 129x42, both fully on screen.
  assert.match(client, /const DEFAULT_PRESET = \{ cols: 132, rows: 43 \};/);
  assert.match(client, /function defaultPreset\(\) \{ return DEFAULT_PRESET; \}/);
  // From a measured cell, because the font is the user's monospace stack at whatever size the browser
  // gives it — a character width is not something this file can know.
  assert.match(client, /term\._core\._renderService\.dimensions\.css\.cell/);
});

test('a size somebody chose is never overridden', () => {
  // The correction applies to a window that merely opened narrow, not to one deliberately made small.
  assert.match(client, /if \(!pane\.dataset\.geom && term\.cols < defaultPreset\(\)\.cols\)/);
  assert.match(client, /if \(remembered\) win\.dataset\.geom = '1';/);
  assert.match(client, /win\.dataset\.geom = '1';\s*\/\/ it has a size somebody chose now/);
});

test('a resize re-attaches, because there is no resize channel', () => {
  assert.match(client, /const wire = \(\) => \{/);
  assert.match(client, /pane\.__resized = resized;/);
  // Debounced, and only when the size in CHARACTERS changed: two pixels is not a reconnect.
  assert.match(client, /if \(term\.cols === attachedAt\.cols && term\.rows === attachedAt\.rows\) return;/);
  // The debounce body is long enough that a bounded [\s\S] window is a test about its length rather
  // than its behaviour; assert the two things that matter instead.
  assert.match(client, /resizeTimer = setTimeout\(/);
  const body = client.slice(client.indexOf('resizeTimer = setTimeout('));
  assert.match(body.slice(0, 700), /wire\(\);/, 'and it re-attaches');
});

test('the old attach detaches itself before the new one opens', () => {
  // Ctrl-A d is screen's own detach for THIS display. Without it the size correction is defeated by
  // the clients left behind.
  assert.match(client, /ws\.send\(String\.fromCharCode\(1\)\); ws\.send\('d'\);/);
});

test('the server adapts the window and reaps the whole attach', () => {
  assert.match(server, /exec screen -A -x \$\{session\}/, '-A adapts the window to this display');
  assert.match(server, /detached: true/, 'its own process group');
  assert.match(server, /process\.kill\(-child\.pid, 'SIGHUP'\)/, 'so the group can be killed, not just script');
  assert.match(server, /screen fits a window to EVERY attached display/, 'and the reason is written down');
});

test('reset lands on the same size a window opens at', () => {
  // The menu entry and the double-click go to the default, and the label says which size that is —
  // "biggest that fits this display" described the old behaviour and would now be a lie.
  assert.match(screens, /Reset to 132 &times; 43/);
  assert.match(screens, /term-fit/);
  assert.match(client, /const sizePick = e\.target\.closest\('\[data-term-size\]'\);/);
  assert.match(client, /Double-click the title bar puts a window back/);
  // And the stored geometry is forgotten, or it would come back the next time it opens.
  assert.match(client, /delete all\[win\.dataset\.session\];/);
});

test('nothing but a real child may go in termChildren', () => {
  // It is BOTH the shutdown list and what MAX_TERMINALS counts. A helper object was added to it so
  // shutdown could kill the process group — it was never removed, so after eight opens every further
  // WebSocket upgrade answered 503 and the terminal opened blank. The group kill belongs in the
  // shutdown loop, over the real children.
  const adds = [...server.matchAll(/termChildren\.add\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(adds, ['child'], 'only the child itself');
  assert.match(server, /for \(const c of termChildren\) \{[\s\S]{0,200}process\.kill\(-c\.pid, 'SIGHUP'\)/);
  assert.match(server, /it is also what MAX_TERMINALS counts, so nothing else may ever be put in it/);
});
