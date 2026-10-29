const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const server = read('server.js');
const screens = read('screens.js');
const lists = read('lists.js');

test('Home has one h1, and each workspace card title is an h2', () => {
  assert.match(server, /<h1 class="uk-h4 uk-margin-remove">Workspaces <span class="uk-text-meta">\$\{keys\.length\}<\/span><\/h1>/);
  assert.match(server, /<h2 class="uk-card-title uk-margin-remove uk-text-bold">\$\{esc\(w\.label\)\}<\/h2>/);
  assert.doesNotMatch(server, /<h4 class="uk-card-title/);
});

test('a project list is an h2 under the workspace h1', () => {
  assert.match(server, /<h2 class="uk-h3 uk-margin-remove">\$\{esc\(heading\)\} <span class="uk-badge">/);
});

test('Playwright browsers sit in a one-column group with its own h2', () => {
  assert.match(screens, /<h2 class="uk-h4[^"]*" id="screens-browsers-title">Playwright browsers<\/h2>\s*<div class="screens-list" data-cols="1" role="group" aria-labelledby="screens-browsers-title">/);
});

test('filters say what they filter, and the visible word is inside the accessible name', () => {
  assert.match(server, /<label class="uk-text-meta">State\s*<select[^>]*aria-label="Filter [^"]*by state"/);
  assert.match(server, /<label class="uk-text-meta">Type\s*<select[^>]*aria-label="File type"/);
  assert.match(lists, /<label class="list-pager-size uk-text-meta">Per page\s*<select[^>]*aria-label="How many rows per page"/);
});

test('the Build button is as tall as the fields beside it', () => {
  const css = read('public', 'css', 'components', 'mic-on-any-field-that-wants-typing.css');
  assert.match(css, /\.build-form \.uk-button-primary \{[^}]*height:2\.625rem; line-height:2\.625rem;/);
});

test('swap listeners use htmx 4 event names, which are the only ones it fires', () => {
  for (const f of ['ui.js', 'mic.js']) {
    assert.doesNotMatch(read('public', f), /'htmx:(afterSwap|beforeSwap|afterSettle)'/, `${f} listens for an event htmx 4 never fires`);
  }
});
