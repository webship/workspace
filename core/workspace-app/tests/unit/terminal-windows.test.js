/**
 * The screen terminals: floating windows, several at once.
 *
 * Most of this is about the two things that made only ONE terminal possible, both of which look fine
 * in isolation and neither of which a page renders differently:
 *
 *   - the markup addressed its parts by ID, so a second terminal's script found the first one's status
 *     line, buttons and mount point;
 *   - the mount waited for `offsetParent`, which is null for a `position: fixed` element by
 *     definition — so with the panes turned into floating windows, every one of them reported itself
 *     hidden and none ever connected.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { termPaneHtml, termLayerHtml } = require('../../screens');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const server = app('server.js');
const client = app('public/terminal.js');
const css = app('public/css/components/terminals.css');
const screensJs = app('screens.js');
const screenActions = app('actions/screens.js');

const html = termPaneHtml('dev--blog1--claude-1234');

test('a terminal is a window of its own, named by the session', () => {
  assert.match(html, /class="term-window" data-session="dev--blog1--claude-1234"/);
  assert.match(html, /role="dialog"/, 'it is a window, and says so to a screen reader');
  assert.match(html, /aria-label="Terminal — dev--blog1--claude-1234"/);
});

test('nothing in a terminal is addressed by id', () => {
  // The whole reason only one could be open: a second window found the first one's elements.
  assert.doesNotMatch(html, /\sid="/, 'ids are what two windows collide over');
  for (const part of ['term-screen', 'term-status', 'term-reconnect', 'term-fullscreen', 'term-close']) {
    assert.ok(html.includes(`class="${part}"`) || html.includes(`${part}`), `${part} is a class`);
  }
});

test('the session\'s own verbs are on the window, not only on the row behind it', () => {
  // Acting on the session you are watching used to start with closing the terminal you were watching
  // it in.
  assert.match(html, /term-interrupt/);
  assert.match(html, /term-detach/);
  assert.match(html, /term-kill/);
  assert.match(html, /Interrupt what runs in dev--blog1--claude-1234/);
  assert.match(html, /Kill the session dev--blog1--claude-1234/);
  // And the window's own controls, which are a different thing — hence the divider between them.
  assert.match(html, /term-verbs-sep/);
  assert.match(html, /Close this terminal \(dev--blog1--claude-1234 keeps running\)/,
    'closing a window must never read as ending the session');
});

test('every verb that ends something goes through the one confirm dialog', () => {
  for (const verb of ['term-interrupt', 'term-detach', 'term-kill']) {
    const at = html.indexOf(verb);
    assert.ok(at > 0, `${verb} is there`);
    const button = html.slice(at, html.indexOf('</button>', at));
    assert.match(button, /arm-step/, `${verb} is armed`);
  }
  // The two that go to the server fire on the dialog's Yes alone.
  assert.match(html.slice(html.indexOf('term-detach')), /hx-trigger="confirmed-remove"/);
});

test('Ctrl-C goes down the window\'s own socket, not to an endpoint that cannot reach the host', () => {
  // onHostScreen says it itself: "the runner does not proxy them yet" — so /actions/screen-interrupt
  // answers 500 for a session on the host, which is every session. The window is already attached.
  assert.match(screensJs, /the runner does not\s+proxy them yet/,
    'the reason is written down where the button is made');
  const button = html.slice(html.indexOf('term-interrupt'), html.indexOf('</button>', html.indexOf('term-interrupt')));
  assert.doesNotMatch(button, /hx-post/, 'it does not post anywhere');
  assert.match(client, /String\.fromCharCode\(3\)/, 'terminal.js sends the byte');
});

test('a killed session closes its window', () => {
  // A terminal left open on a dead session is one you can still type into, with nothing on the end.
  assert.match(screenActions, /HX-Trigger.*screen-killed/s);
  assert.match(client, /screen-killed/);
});

test('the mount tests the RECTANGLE, never offsetParent', () => {
  // A fixed element's offsetParent is null by definition, so the obvious test reports every floating
  // terminal as hidden and none of them ever connects. This one cost a debugging round.
  assert.match(client, /getBoundingClientRect\(\);\s*\n\s*return r\.width > 0 && r\.height > 0/);
  // Not a blunt search for the word: the comment above the fix names it, which is the point of it.
  assert.doesNotMatch(client, /\.offsetParent\s*(!==|===)/,
    'offsetParent cannot answer this for a fixed window, so nothing may branch on it');
});

test('a window declares its own footprint', () => {
  // Without border-box the measured rectangle was re-applied as a CONTENT width, so every drag grew
  // the window by its padding and border — 18px a time. The rails hit the same trap.
  assert.match(css, /\.term-window \{[^}]*box-sizing: border-box/s);
});

test('the window remembers where it was put, and is clamped back into view', () => {
  assert.match(client, /ws-term-windows/, 'geometry is per browser, like the theme');
  assert.match(client, /ws-term-layout/);
  assert.match(client, /window\.addEventListener\('resize'/,
    'a display that got smaller must not leave a window off it');
});

test('list and grid arrange every open window', () => {
  assert.match(client, /function arrange\(how\)/);
  assert.match(server, /data-term-layout="list"/);
  assert.match(server, /data-term-layout="grid"/);
});

test('the terminals bar is in the top bar, beside Screens', () => {
  // One glance, two facts: the sessions running on this machine, and the terminals open in this
  // browser. It was a pill floating over the bottom right corner — a second place to look for a thing
  // that belongs with Screens, sitting on top of whatever was in that corner of the page.
  const group = server.slice(server.indexOf("groups.push({ id: 'screens'"));
  const entry = group.slice(0, group.indexOf('] });'));
  assert.match(entry, /id: 'terminals'/, 'in the same navigation group as the session count');
  assert.match(entry, /id="term-bar"/);
  assert.match(entry, /topbar: 'end'/);
  // Its own entry, so it can be moved or hidden in Settings → Navigation without taking the session
  // count with it.
  assert.match(entry, /label: 'Terminals'/);
  // And BEFORE it, so the pair reads inwards — the terminals you have open, then the sessions they are
  // open on — and Screens keeps the end of the top bar, where it has always been.
  assert.ok(entry.indexOf("id: 'terminals'") < entry.indexOf("id: 'open-screens'"),
    'the terminals bar sits to the left of the session count');
  assert.doesNotMatch(client, /createElement\('div'\);\s*\n\s*bar\.id/, 'the client no longer makes one');
});

test('the bar says nothing until there is something to say', () => {
  // The count is not the server's to know — a window exists in the browser that opened it — so the
  // markup ships empty and hidden, and the client unhides it.
  const group = server.slice(server.indexOf("groups.push({ id: 'screens'"));
  assert.match(group.slice(0, group.indexOf('] });')), /id="term-bar"[^`]*hidden/);
  assert.match(client, /bar\.hidden = !n;/);
});

test('the layer is empty until something is opened', () => {
  assert.equal(termLayerHtml(), '<div id="term-windows"></div>');
  assert.match(termLayerHtml(['a1']), /term-window" data-session="a1"/);
});

test('every way in opens a window, and none of them fills the editor modal', () => {
  // Two places in the core open a terminal — the Screens row and the SCREENS dropdown on a project —
  // and plugins (Jira's agent button) use the same attribute; each used to replace the one modal, which
  // is what made a second one impossible.
  const openers = (server + screensJs).match(/data-open-terminal=/g) || [];
  assert.ok(openers.length >= 2, `every opener is declarative (found ${openers.length})`);
  assert.doesNotMatch(server + screensJs,
    /screen-term\/\$\{[^}]*\}"\s+hx-target="#editor-modal-body"/,
    'a terminal never goes into the editor modal again');
});
