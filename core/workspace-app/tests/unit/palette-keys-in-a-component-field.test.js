/**
 * A key typed in a field inside a web component stays in the field: `/` and `?` do not open the palette (webship/workspace#671).
 *
 * The AI Assistant's message box is a field inside deep-chat's shadow root. A key typed there reaches the page with
 * `<deep-chat>` as the event's target, which is no field, so `/` opened the palette, `?` the shortcuts, and the rest of
 * the message was typed into the palette. The palette now asks about the element the key went to: the first node of
 * the event's path. Checked in a browser too: "How do I run the tests? /dev" stays whole in the box, and `/` on the
 * page still opens the palette.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'palette.js'), 'utf8');
const body = src.slice(src.indexOf('  function typing(e) {'), src.indexOf('  function modalOpen()'));
// eslint-disable-next-line no-new-func
const typing = new Function(`${body}; return typing;`)();

const el = (tagName, { editable = false, inside = '' } = {}) => ({
  tagName, isContentEditable: editable, closest: (sel) => (inside && sel.split(', ').includes(inside) ? {} : null),
});
const key = (target, pathFirst) => ({ target, composedPath: () => (pathFirst ? [pathFirst, target] : []) });

test('a field inside a shadow root is a field, though the event\'s target is its host', () => {
  assert.strictEqual(typing(key(el('DEEP-CHAT'), el('DIV', { editable: true }))), true, 'deep-chat\'s message box');
  assert.strictEqual(typing(key(el('MY-WIDGET'), el('INPUT'))), true, 'an input inside any component');
});

test('deep-chat counts as a field when the path stops at it', () => {
  assert.strictEqual(typing(key(el('DEEP-CHAT'))), true);
  assert.strictEqual(typing({ target: el('DEEP-CHAT') }), true, 'and with no composedPath at all');
});

test('the page itself is not a field, so / and ? still open the palette there; the fields it knew stay fields', () => {
  assert.strictEqual(typing(key(el('BODY'), el('BODY'))), false);
  assert.strictEqual(typing(key(el('BUTTON'), el('BUTTON'))), false);
  for (const t of ['INPUT', 'TEXTAREA', 'SELECT']) assert.strictEqual(typing(key(el(t), el(t))), true, t);
  assert.strictEqual(typing(key(el('DIV'), el('DIV', { inside: '.xterm' }))), true, 'a terminal');
  assert.strictEqual(typing(key(el('DIV'), el('DIV', { inside: '.ace_editor' }))), true, 'the code editor');
});

test('the key handler asks with the event, not its target', () => {
  assert.match(src, /if \(typing\(e\) \|\| modalOpen\(\)\) return;/);
  assert.doesNotMatch(src, /typing\(e\.target\)/);
});
