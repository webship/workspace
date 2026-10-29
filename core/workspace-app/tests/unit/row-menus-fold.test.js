const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(root, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'components', 'ddev-menu.css'), 'utf8');

test('every long row menu folds, not only DDEV', () => {
  assert.match(ui, /querySelectorAll\('\.act-menu \.uk-dropdown:not\(\[data-folded\]\)'\)/);
  assert.match(ui, /if \(links < 8 && rows < 12\) return;/);
});

test('a group ends at a divider, a short group does not fold, and only a short first group opens', () => {
  assert.match(ui, /!n\.classList\.contains\('uk-nav-divider'\)/);
  assert.match(ui, /if \(rows\.length < 3\) return;/);
  assert.match(ui, /const open = \(folds === 0 && rows\.length <= 6\) \|\| \/this project\/i\.test/);
});

test('a menu that opens near the top moves the page so the top bar does not cover it', () => {
  assert.match(ui, /document\.addEventListener\('shown', \(e\) => \{/);
  assert.match(ui, /window\.scrollBy\(\{ top: top - limit/);
});

test('the menus are one 18rem column, including COMPOSER and NODE', () => {
  assert.match(css, /\.project-row \.act-menu \.uk-dropdown \{ min-width: 0; width: 18rem;/);
  assert.match(css, /:is\(\.composer-columns, \.node-columns\) \{ display: block; \}/);
});
