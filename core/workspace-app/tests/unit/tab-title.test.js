/**
 * The tab says when a session is waiting.
 *
 * A session that stops to ask something is a run that is not happening until somebody answers, and the dashboard
 * is usually in another tab. Vercel shows a build's state in the tab; this does the same for the one state that
 * needs a person. Only "waiting" goes in the title: a count of detached sessions is noise.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public/ui.js'), 'utf8');
const block = ui.slice(ui.indexOf('const BASE_TITLE = document.title;'), ui.indexOf('/* ---------------- the rail, arranged'));

test('the page title is kept, and a waiting session is put in front of it', () => {
  assert.match(block, /const BASE_TITLE = document\.title;/);
  assert.match(block, /document\.title = `✋ \$\{n\} waiting · \$\{BASE_TITLE\}`;/);
  assert.match(block, /if \(!w\) \{ document\.title = BASE_TITLE; return; \}/, 'and it goes back when nothing waits');
});

test('it reads what the toolbar already shows, rather than asking the server again', () => {
  assert.match(block, /document\.querySelector\('\.screens-count \.screens-waiting'\)/);
  assert.match(block, /replace\(\/\[\^0-9\]\/g, ''\)/);
});

test('it runs whenever the badge changes, however it was rewritten, and once at load', () => {
  assert.match(block, /new MutationObserver\(syncTitleState\)\.observe\(screensCountEl, \{ childList: true, subtree: true, characterData: true \}\)/);
  assert.match(block, /document\.body\.addEventListener\('htmx:after:swap'/, 'the swap event still counts too');
  assert.match(block, /\nsyncTitleState\(\);\n/);
});

test('the fragment it reads marks a waiting session, and only then', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /waiting\.length \? ` <span class="uk-label uk-label-warning screens-waiting"/);
});
