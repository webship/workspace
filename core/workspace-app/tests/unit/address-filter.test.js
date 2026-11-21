/**
 * A project answers at its DDEV address and at every extra one its config names; past the first, they are
 * a list behind a "+N" button, 15rem tall. Nine or more host names took scrolling to find one, so from nine
 * on the list has a filter at its top.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');

test('the list of addresses has a filter from nine on, named for the project, with a line that says what is left', () => {
  const src = read('server.js');
  assert.match(src, /const ADDRESS_FILTER_AT = 9;/);
  const at = src.indexOf('<div class="pcard-domains" id="${addrListId}" uk-dropdown=');
  assert.ok(at > 0, 'no list of addresses');
  const card = src.slice(at, at + 900);
  assert.match(card, /\$\{extraAddresses\.length >= ADDRESS_FILTER_AT \?/, 'only for a long list');
  assert.match(card, /class="uk-input uk-form-small pcard-domains-filter" placeholder="Filter \$\{extraAddresses\.length\} addresses"/);
  assert.match(card, /aria-label="Filter the \$\{extraAddresses\.length\} addresses of \$\{esc\(ddevName\)\}"/);
  assert.match(card, /<p class="pcard-domains-status" role="status"><\/p>/);
});

test('typing narrows the list by host name and says how many are left; Escape empties the box before it closes the list', () => {
  const ui = read('public', 'ui.js');
  const at = ui.indexOf("const box = e.target.closest && e.target.closest('.pcard-domains-filter');");
  assert.ok(at > 0, 'no filter handler');
  const block = ui.slice(at - 200, at + 1600);
  assert.match(block, /li\.querySelector\('\.host'\)\.textContent\.toLowerCase\(\)\.includes\(q\)/, 'by host name');
  assert.match(block, /`\$\{shown\} of \$\{items\.length\} shown\.` : 'Nothing matches\.'/);
  assert.match(block, /if \(!box \|\| !box\.value\) return;[\s\S]{0,80}e\.stopPropagation\(\);/, 'a box with text: Escape empties it and the list stays');
  assert.match(block, /'shown'[\s\S]{0,200}box\.focus\(\)/, 'the box takes focus when the list opens');
});

test('what is filtered out is gone from the list, and the line has the interface face, not the host names\' one', () => {
  const css = read('public', 'css', 'components', 'project-cards.css');
  assert.match(css, /\.pcard-domains li\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.pcard-domains-status \{[^}]*font-family: var\(--font-primary\)/);
  // Empty, it takes no room but stays in the accessibility tree (2026-11-21): display:none until its first
  // words, a live region may not have them spoken.
  assert.match(css, /\.pcard-domains-status:empty \{ margin: 0; \}/);
  assert.doesNotMatch(css, /\.pcard-domains-status:empty \{ display: none; \}/);
});

// From the accessibility test of 2026-11-21 (WCAG 4.1.2): the "+N" was announced as a menu button
// (aria-haspopup="true", which UIkit puts on every dropdown's toggle), and it opens a filter and a list.
test('the "+N" button is a disclosure of its list: aria-controls, and no aria-haspopup', () => {
  const src = read('server.js');
  assert.match(src, /const addrListId = `addresses-\$\{String\(key\)\.replace\(\/\[\^A-Za-z0-9_-\]\/g, '-'\)\}-\$\{String\(p\)\.replace\(\/\[\^A-Za-z0-9_-\]\/g, '-'\)\}`;/);
  assert.match(src, /<button class="pcard-count" type="button" aria-controls="\$\{addrListId\}"/);
  assert.doesNotMatch(src, /class="pcard-count" type="button" aria-haspopup/);
  const ui = read('public', 'ui.js');
  const at = ui.indexOf('(function addressListIsADisclosure() {');
  assert.ok(at > 0, 'nothing takes off what UIkit sets');
  const body = ui.slice(at, ui.indexOf('})();', at));
  assert.match(body, /el\.matches\('\.pcard-count\[aria-controls\]'\) && el\.hasAttribute\('aria-haspopup'\)\) el\.removeAttribute\('aria-haspopup'\)/);
  assert.match(body, /\.observe\(document\.documentElement, \{ subtree: true, attributes: true, attributeFilter: \['aria-haspopup'\] \}\)/);
});

test('the Settings modal\'s filter line also stays in the accessibility tree while empty', () => {
  const css = read('public', 'css', 'components', 'tab-modal.css');
  assert.match(css, /\.tabmodal-filter-status:empty \{ margin: 0; min-height: 0; \}/);
  assert.doesNotMatch(css, /\.tabmodal-filter-status:empty \{ display: none; \}/);
});
