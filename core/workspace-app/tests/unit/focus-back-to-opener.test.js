/**
 * A menu or the editor modal that closes gives keyboard focus back to what opened it.
 *
 * Measured in round 7: Escape on an open row menu left document.activeElement on <body>; a modal opened by a
 * row button (Clone, Configure DDEV, New screen here…) gave focus back to nothing when it closed, and a
 * button that did get it back lost it again when the project list was redrawn under it (refresh-projects).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');

test('a dropdown that closes with focus inside it gives focus to its own button', () => {
  const block = ui.slice(ui.indexOf('// A menu that closes with focus inside it gives focus back to the button that opened it.'));
  assert.match(block, /document\.addEventListener\('beforehide', \(e\) => \{/);
  assert.match(block, /drop\.classList\.contains\('uk-dropdown'\)/);
  assert.match(block, /if \(!drop\.contains\(document\.activeElement\)\) return;/, 'only when focus was in the menu');
  assert.match(block, /window\.UIkit\.dropdown\(drop\)\.targetEl/, "UIkit's own button for the menu");
  // Not when something else has taken focus in the meantime (a modal the pick opened, a field it revealed).
  assert.match(block, /if \(now && now !== document\.body && !drop\.contains\(now\)\) return;/);
});

test('swappedEl answers the element that was swapped, from the request context htmx 4 sends', () => {
  const src = ui.match(/function swappedEl\(e\) \{[\s\S]*?\n\}/)[0];
  const swappedEl = vm.runInNewContext(`(${src.replace('function swappedEl', 'function')})`);
  const body = { nodeType: 1, id: 'editor-modal-body' };
  const button = { nodeType: 1, id: '' };
  // htmx 4: the event is dispatched on the element that asked, and the swapped one is detail.ctx.target.
  assert.equal(swappedEl({ detail: { ctx: { target: body } }, target: button }), body);
  // An older shape that names it directly still works, and with no detail it is the event's target.
  assert.equal(swappedEl({ detail: { target: body }, target: button }), body);
  assert.equal(swappedEl({ target: button }), button);
  // A target that is not an element (a selector string) falls back to the event's target.
  assert.equal(swappedEl({ detail: { ctx: { target: '#x' } }, target: button }), button);
  // An outerHTML swap whose answer starts with a line break: htmx 4 fires on that text node, and the
  // element is the first one put in (a followed log's view replacing itself every second, #634).
  const text = { nodeType: 3, parentElement: body };
  const job = { nodeType: 1, id: 'job-1' };
  assert.equal(swappedEl({ detail: { task: { target: text }, newContent: [text, job, { nodeType: 3 }] }, target: text }), job);
  // With nothing else to go by, the element it went into; never a node without an id or a classList.
  assert.equal(swappedEl({ detail: {}, target: text }), body);
});

test('the editor modal remembers who opened it as it starts to open, whichever way it was opened', () => {
  const block = ui.slice(ui.indexOf("document.addEventListener('beforeshow', (e) => {\n  if (!e.target || e.target.id !== 'editor-modal'"));
  assert.ok(block.length, 'a beforeshow listener for the editor modal');
  assert.match(block.slice(0, 400), /editorModalOpener = from && from !== document\.body && !e\.target\.contains\(from\) \? from : null;/);
  // And closing it still gives focus back to that opener.
  assert.match(ui, /if \(opener && opener\.isConnected\) setTimeout\(\(\) => \{ try \{ opener\.focus\(\); \}/);
});

test('a row control keeps focus through a redraw of the project list', () => {
  const block = ui.slice(ui.indexOf('(function keepRowFocusThroughRedraws() {'));
  assert.ok(block.length, 'the keeper is there');
  assert.match(block, /row\.querySelector\('\.pcard-title'\)/, 'a row is found again by the title it is named by');
  assert.match(block, /row\.querySelector\('\.item-machine'\)/, 'and an item row (a doc, an agent) by its machine name');
  assert.match(block, /a\.closest\('\.act-menu'\)/, 'a menu button by its menu');
  assert.match(block, /target\.focus\(\{ preventScroll: true \}\)/);
  // A field being typed in is the other keeper's, which also keeps its value and caret.
  assert.match(block, /a\.matches\('input\[name\], textarea\[name\]'\)/);
});
