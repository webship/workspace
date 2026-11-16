/**
 * A session picked in a project row's SCREENS menu opens the Screens modal, with that session first.
 *
 * Screens open in the modal (the top bar's Screens button, a notice's "Open in Screens", a row's "All
 * screens"): a link to /screens?session=<name> is that modal wherever it is drawn. The row's own list of
 * sessions was the one way in that still opened the terminal window at once, so the same session opened
 * two different ways depending on where it was picked, and this way skipped its state and its log.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');

const menuBody = server.slice(server.indexOf('async function screensMenuBody('), server.indexOf('const CORE_ROW_MENUS'));

test('a session in the row menu links to the Screens modal, asked first', () => {
  assert.ok(menuBody.length > 0, 'screensMenuBody is where the row menu is drawn');
  assert.match(menuBody, /<li data-entry="open a screen"><a href="\/screens\?session=\$\{encodeURIComponent\(s\.session\)\}"/);
});

test('the row menu opens no terminal window of its own', () => {
  assert.doesNotMatch(menuBody, /data-open-terminal/, 'a pick opens the modal; the terminal is its own button there');
});

test('a link to /screens?session=<name> is what opens the modal, wherever it is drawn', () => {
  // The one handler the row menu now relies on: same origin, the /screens path, a session name it accepts.
  const block = ui.slice(ui.indexOf('function screensModalUrl(href)'));
  assert.match(block, /u\.pathname !== '\/screens'/);
  assert.match(block, /\/fragments\/screens\?session=\$\{encodeURIComponent\(name\)\}/);
  // A typical session name passes the handler's check, so the session is first in the modal.
  const re = /^[a-z0-9][A-Za-z0-9._-]*$/;
  assert.ok(re.test('dev--r7-alpha--git-status'));
  assert.ok(block.includes(re.source), 'the handler checks the name the same way');
});
