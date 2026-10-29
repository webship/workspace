const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const server = read('server.js');
const ui = read('public', 'ui.js');

test('the guide has contents and search, with each section its own unit', () => {
  assert.match(server, /<nav class="help-toc" aria-label="On this page">/);
  assert.match(server, /class="uk-input help-find"/);
  assert.match(server, /data-help-section=/);
  assert.match(ui, /function helpPage\(\)/);
  assert.match(ui, /IntersectionObserver/);
});

test('every page links to the part of the guide about it, and code blocks can be copied', () => {
  assert.match(server, /function helpAnchorFor\(context\)/);
  assert.match(server, /data-help="\$\{helpAnchorFor\(context\)\}"/);
  assert.match(ui, /a\.href = `\/help#\$\{where\}`;/);
  assert.match(ui, /className = 'help-copy'/);
});

test('the Commands Sort applies inside each group', () => {
  assert.match(read('commands-page.js'), /sortBy === 'nameDesc'/);
});

test('the guide links to its own sections and its screenshots exist', () => {
  const guide = read('docs', 'USER-GUIDE.md');
  for (const m of guide.matchAll(/\]\(screenshots\/([^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.join(root, 'docs', 'screenshots', m[1])), m[1]);
  }
  assert.match(guide, /Claude\s+Code here…/);
  assert.match(guide, /Find a setting in this file/);
});
