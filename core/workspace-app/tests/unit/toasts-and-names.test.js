/**
 * A result that is an error does not leave on a timer, a result is held while it has focus, and the
 * controls of the shell are named by what is printed on them (WCAG 2.2.1, 4.1.3, 2.5.3, 2.4.6).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const ui = read('public/ui.js');
const server = read('server.js');

test('an error toast is an alert that stays until it is closed', () => {
  assert.match(ui, /if \(isError\) \{ msg\.setAttribute\('role', 'alert'\); msg\.classList\.add\('is-held'\); return; \}/);
  const at = ui.indexOf("if (isError) { msg.setAttribute('role', 'alert')");
  assert.ok(at < ui.indexOf('let timer = setTimeout(done, ms);', at - 2000) || ui.indexOf('let timer = setTimeout(done, ms);') > at, 'before any timer is started');
});

test('a toast is held while the pointer is over it or focus is inside it', () => {
  assert.match(ui, /msg\.addEventListener\('focusin', hold\);/);
  assert.match(ui, /msg\.addEventListener\('focusout', \(\) => setTimeout\(release, 0\)\);/);
  assert.match(ui, /if \(msg\.matches\(':hover'\) \|\| msg\.contains\(document\.activeElement\)\) return;/);
});

test('the shell controls are named by what they show, and its landmarks have names', () => {
  assert.match(server, /aria-label="Ctrl K: open the command palette"/);
  assert.match(server, /aria-label="Hold to talk Space: hold this button, or the Space bar"/);
  assert.match(server, /<nav class="uk-navbar-container toolbar" aria-label="Toolbar">/);
  assert.match(server, /<aside class="assistant-side" aria-label="AI Assistant">/);
});

test('the dictate button of a field is named after the field', () => {
  const mic = read('public/mic.js');
  assert.match(mic, /`Dictate into \$\{into\}`/);
  assert.match(mic, /field\.labels && field\.labels\[0\] && field\.labels\[0\]\.textContent/);
});
