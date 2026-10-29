/**
 * The Screens page: one session under another by default, two or three across on request.
 *
 * One is the default deliberately. A session row carries its name, its state, its log path and five
 * verbs, and two of those side by side on a 1400px screen leaves each narrower than the buttons it
 * holds. Two and three are for a machine with a dozen sessions, where the question is "which of these
 * is waiting" rather than "what does this one say".
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const screens = read('screens.js');
const ui = read('public/ui.js');
const css = read('public/css/components/grid-and-list.css');

test('both children span the container, which is itself a grid', () => {
  // #webship-workspace-projects is the same grid the project rows are laid out in, so a wrapper dropped
  // into it becomes ONE CELL: the toolbar took the first column, the whole list the second, and half
  // the page was empty. Found by looking at the page, not by reading the CSS.
  assert.match(css, /\.screens-toolbar \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.screens-list \{ grid-column: 1 \/ -1;/);
  assert.match(screens, /uk-margin-small screens-toolbar/, 'the toolbar carries the class that spans');
});

test('the list ships at one across', () => {
  assert.match(screens, /<div class="screens-list" data-cols="1">/,
    'the server renders the default, so the page is right before any script runs');
  assert.match(css, /\.screens-list \{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
    'one column unless asked otherwise');
});

test('two and three across are offered, and only those', () => {
  // The buttons are one loop over the counts, so the counts are what to assert — the attribute itself
  // is a template, and matching its rendered form would be matching my own interpolation.
  assert.match(screens, /data-screens-cols="\$\{n\}"/);
  const counts = screens.slice(screens.indexOf("[['1', 'list'"));
  assert.match(counts.slice(0, 200), /\['1', 'list'[^\]]*\], \['2', 'grid'[^\]]*\], \['3', 'grid'[^\]]*\]/);
  assert.doesNotMatch(counts.slice(0, 200), /\['[456]'/, 'a session row cannot take a quarter of the page');
  assert.match(css, /\.screens-list\[data-cols="2"\]/);
  assert.match(css, /\.screens-list\[data-cols="3"\]/);
});

test('a column is sized by its share, never by the longest session name', () => {
  // `dev--amd-website_starter-1-0-x-site-template--build` is one unbroken token, and a track sized to its
  // content is how a list of them ends up scrolling sideways.
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
});

test('the choice survives the refresh that replaces the list every 20 seconds', () => {
  // A class set once would last exactly one poll.
  const block = ui.slice(ui.indexOf('(function screensColumns()'));
  assert.match(block, /htmx:after:swap/);
  assert.match(block, /ws-screens-cols/, 'kept per browser, like the theme and the page width');
  assert.match(block, /\['1', '2', '3'\]\.includes/, 'anything else falls back to one across');
});

test('the modal is as wide as what it is showing', () => {
  // It was a flat 1100px whatever was in it, so three columns of session cards came out at 338px each
  // — narrower than the row of buttons inside them — while 463px of a 1563px window went unused.
  assert.match(css, /#editor-modal\[data-screens-cols\] \.uk-modal-dialog \{ width: min\(94vw, 1200px\); \}/);
  assert.match(css, /#editor-modal\[data-screens-cols="2"\][^{]*\{ width: min\(94vw, 1500px\); \}/);
  assert.match(css, /#editor-modal\[data-screens-cols="3"\][^{]*\{ width: min\(94vw, 1900px\); \}/);
  // min(…, 94vw) is what keeps it inside the window: a fixed 1900px dialog on a 1440px laptop is a
  // modal with its right-hand column off the screen.
  assert.match(css, /94vw/);
});

test('the width belongs to the list, not to the modal', () => {
  // #editor-modal is the ONE modal in this dashboard. An editor opened after the screens must not
  // inherit a width chosen for three columns of session cards.
  const block = ui.slice(ui.indexOf('(function screensColumns()'));
  assert.match(block, /if \(modal\.contains\(list\)\) modal\.dataset\.screensCols = read\(\);/);
  assert.match(block, /else delete modal\.dataset\.screensCols;/);
});
