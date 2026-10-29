/**
 * Opening a screen window, and the state a session leaves in a terminal.
 *
 * Three faults, all reported as "the terminal is weird":
 *
 *   1. A window sometimes opened blank and stayed blank. The repaint that makes an idle session show
 *      itself was one shot at 400ms — a guess about how long `script` + `stty` + the screen client
 *      take on a loaded machine.
 *   2. Ctrl-C and Detach in that window did nothing but print a command to go and type, for sessions
 *      this process could drive all along: the guard refused every verb for a session marked `host`,
 *      which is every session, since that is what `listScreens` labels them.
 *   3. Attaching from a real terminal and scrolling wrote mouse coordinates into the shell. screen
 *      replays the window's output state to each display that attaches, so a program that turned
 *      mouse reporting on and died without turning it off leaves every later terminal reporting the
 *      mouse at a shell that is not listening. Reproduced with `script -qfc "screen -x …"`: the
 *      attaching terminal receives `ESC[?1000h ESC[?1006h`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const jobs = fs.readFileSync(path.join(APP, 'jobs.js'), 'utf8');
const runner = fs.readFileSync(path.join(APP, 'scripts/screen-runner.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/screens.js'), 'utf8');
const screens = fs.readFileSync(path.join(APP, 'screens.js'), 'utf8');
const terminal = fs.readFileSync(path.join(APP, 'public/terminal.js'), 'utf8');
const screenrc = fs.readFileSync(path.join(APP, 'screenrc'), 'utf8');

test('a blank window is repainted until it paints, not once and hopefully', () => {
  const attach = server.slice(server.indexOf('termWss.handleUpgrade'));
  assert.match(attach, /let painted = false;/);
  assert.match(attach, /child\.stdout\.on\('data', \(d\) => \{ painted = true;/);
  assert.match(attach, /\[250, 900, 2500, 5000\]\.map\(\(ms\) => setTimeout/);
  assert.match(attach, /if \(painted\) return;/, 'and it stops as soon as there is something on screen');
  // The timers are cleared when the attach ends, or a closed window keeps asking a session to repaint.
  assert.match(attach, /const stopRepaints = \(\) => repaints\.forEach\(clearTimeout\);/);
  assert.match(attach, /child\.on\('exit', \(\) => \{ stopRepaints\(\);/);
});

test('an attached window that never paints says so', () => {
  // Connected is not painted: `screen -x` attaches to a window whose program may be sitting idle, and
  // a window that came up with nothing in it looks exactly like one that stalled.
  assert.match(terminal, /pane\.__silence = setTimeout\(/);
  assert.match(terminal, /attached — nothing painted yet, press a key or use ↻/);
  assert.match(terminal, /pane\.dataset\.painted = '1';/, 'and the first byte takes the message away');
  assert.match(terminal, /clearTimeout\(pane\.__silence\);/);
});

test('the window verbs actually run, here, instead of printing a command to type', () => {
  const fn = actions.slice(actions.indexOf('async function onHostScreen'), actions.indexOf('function runnerDownHtml'));
  // Stopping still goes through the runner that owns the process group.
  assert.match(fn, /row\.where === 'host' && args\.includes\('quit'\)/);
  // Everything else is tried locally: /run/screen is shared with this container, which is the same
  // reason `screen -x` attaches at all.
  assert.match(fn, /const out = await run\('screen', args, process\.env\.HOME/);
  assert.match(fn, /if \(out\.ok\) return out;/);
  // And the fallback message is only for a real failure, with the command that was actually attempted.
  assert.match(fn, /If this keeps failing, run it in your terminal: screen -S \$\{session\} -X \$\{verb\}/);
});

test('the mouse modes can be cleared, and it says what it does first', () => {
  assert.match(actions, /'\/actions\/screen-reset-modes': screen_verb,/);
  const branch = actions.slice(actions.indexOf("if (pathname === '/actions/screen-reset-modes')"));
  assert.match(branch, /form\.confirm !== 'yes'/, 'it types a line into the session, so it asks');
  assert.match(branch, /typed <code>printf<\/code> at the session's prompt/,
    'and says plainly that a full-screen program would have received it instead');
  // The modes a TUI turns on: mouse (three trackings, two encodings) and bracketed paste.
  for (const m of ['?1000l', '?1002l', '?1003l', '?1006l', '?1015l', '?2004l']) {
    assert.ok(actions.includes(m), `clears ${m}`);
  }
});

test("the escape is doubled, because screen's stuff eats one", () => {
  // A single `\033` reaches the shell as a raw ESC byte, which readline takes as the start of a key
  // sequence — leaving `printf '1000l'` on the prompt and the mode still set. Read back from the
  // window with `screen -X hardcopy`, both ways round.
  const line = actions.match(/const MODE_RESETS = [\s\S]*?join\(''\);/)[0];
  // eslint-disable-next-line no-eval
  const sent = eval(line.replace('const MODE_RESETS =', '')).toString();
  assert.ok(sent.startsWith('\\\\033['), 'a literal backslash reaches the shell, not an ESC byte');
  assert.ok(!sent.includes('\u001b'), 'no raw escape byte is stuffed');
});

test('the button is in the window, armed, and named after the symptom', () => {
  assert.match(screens, /term-reset-modes arm-step/);
  assert.match(screens, /hx-post="\/actions\/screen-reset-modes"/);
  assert.match(screens, /hx-trigger="confirmed-remove"/, 'it goes through the confirm dialog');
  assert.match(screens, /the wheel writes characters instead of scrolling/,
    'named for what you would search for, not for what it sends');
  // The icon has to exist in the vendored set or it draws an empty box.
  const icons = fs.readFileSync(path.join(APP, 'public/vendor/uikit-icons.min.js'), 'utf8');
  assert.ok(icons.includes("crosshairs:'<svg"), 'crosshairs is a real UIkit icon');
});

test('every session the dashboard starts runs under its own screenrc', () => {
  // There was none, so each session took screen's defaults: 100 lines of scrollback (one screen of a
  // build log), no alt-screen, and Ctrl-S as flow control.
  assert.match(jobs, /const SCREENRC = require\('path'\)\.join\(__dirname, 'screenrc'\);/);
  assert.match(jobs, /const screenCmd = \(\) => `screen -c \$\{JSON\.stringify\(SCREENRC\)\}`;/);
  assert.ok(!/(^|[^-])screen -dmS/.test(jobs), 'no launcher starts a bare screen');
  assert.match(runner, /const SCREENRC = path\.join\(__dirname, '\.\.', 'screenrc'\);/);
  assert.match(runner, /execFile\('screen', \['-c', SCREENRC,/);

  // And each line in it is there for a symptom.
  assert.match(screenrc, /^altscreen on$/m);
  assert.match(screenrc, /^defscrollback 10000$/m);
  assert.match(screenrc, /^defflow off$/m);
  assert.match(screenrc, /^mousetrack off$/m);
  assert.match(screenrc, /^defutf8 on$/m);
  // It is the dashboard's, not the machine's: a person's own ~/.screenrc must not change.
  assert.ok(!screenrc.includes('~/.screenrc'));
});
