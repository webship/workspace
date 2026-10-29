/**
 * The confirm dialog (ui.js + the `#confirm-modal` in server.js's pageShell). Every important action —
 * remove, delete, reset, a command that asks before it runs — is a `.arm-step` and must go through it.
 *
 * It replaced a two-step arm whose first click swapped the label for "⚠️ Sure?": a double click did the
 * whole thing, and nothing ever said what was about to happen. What the guards here protect:
 * the click must not navigate (these are links as well as buttons, and a link with an empty href
 * reloads the page and loses the toast the request answers with), only Yes may fire the request, and
 * every other way of closing the dialog — the X, Escape, the backdrop — must count as No.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(app, 'public', 'ui.js'), 'utf8');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const open = ui.slice(ui.indexOf("const btn = e.target.closest('.arm-step');"), ui.indexOf('.confirm-yes'));

test('the dialog is in every page, and says what it asks', () => {
  const modal = server.slice(server.indexOf('id="confirm-modal"'), server.indexOf('id="confirm-modal"') + 900);
  assert.ok(modal.length > 100, 'no #confirm-modal in pageShell');
  assert.match(modal, /role="alertdialog"/, 'an alertdialog, so it is announced');
  assert.match(modal, /stack: true/, 'it must stack: an action can be armed inside the editor modal');
  assert.match(modal, /Wait!/);
  assert.match(modal, /Are you sure you want to proceed with this action\?/);
  assert.match(modal, /confirm-no[^>]*>No</, 'No');
  assert.match(modal, /confirm-yes[^>]*>Yes</, 'Yes');
  assert.ok(modal.indexOf('confirm-no') < modal.indexOf('confirm-yes'), 'No comes first: the safe answer is nearest');
});

test('arming opens the dialog, names the action, and navigates nowhere', () => {
  assert.ok(open.length > 0, 'the .arm-step handler was not found');
  assert.match(open, /e\.preventDefault\(\);/, 'the click must not navigate');
  assert.match(open, /getAttribute\('title'\)/, 'an icon-only button says what it is in its title');
  assert.match(open, /getElementById\('confirm-what'\)/, 'what is about to happen is written into the dialog');
  assert.match(open, /UIkit\.modal\('#confirm-modal'\)\.show\(\)/);
  assert.match(open, /window\.confirm\(/, 'with no UIkit on the page, the browser dialog rather than acting unasked');
  assert.ok(!/htmx\.trigger/.test(open), 'opening the dialog must never fire the request by itself');
});

test('only Yes fires the request, and every other way out is No', () => {
  const rest = ui.slice(ui.indexOf('.confirm-yes'), ui.indexOf('The field microphones'));
  assert.match(rest, /^\.confirm-yes'\)\) \{[\s\S]*?runConfirmed\(btn\)/, 'Yes runs it');
  assert.match(rest, /closest\('\.confirm-no'\)\) \{\s*\n\s*pendingConfirm = null;/, 'No forgets it');
  assert.match(rest, /addEventListener\('hidden'[\s\S]*?confirm-modal[\s\S]*?pendingConfirm = null;/,
    'the X, Escape and the backdrop are No as well');
  assert.match(ui, /function runConfirmed\(btn\) \{\s*\n\s*pendingConfirm = null;/,
    'the pending action is forgotten before it runs, so one Yes cannot fire twice');
});

test('the destructive actions are all armed', () => {
  for (const [file, action] of [
    ['server.js', '/actions/delete-item'],
    ['server.js', '/actions/ddev-drush-sql-drop'],
    ['server.js', '/actions/graph-remove'],
    ['server.js', '/actions/rag-remove'],
    ['commands-page.js', '/actions/cc-remove'],
    ['commands-page.js', '/actions/cc-reset'],
  ]) {
    const src = fs.readFileSync(path.join(app, file), 'utf8');
    const i = src.indexOf(`hx-post="${action}"`);
    assert.ok(i > 0, `${action} is gone from ${file}`);
    const line = src.slice(src.lastIndexOf('\n', i - 1), src.indexOf('\n', i) + 400);
    assert.match(line, /arm-step/, `${action} must ask first`);
    assert.match(line, /hx-trigger="confirmed-remove"/, `${action} must fire only on the dialog's Yes`);
  }
});
