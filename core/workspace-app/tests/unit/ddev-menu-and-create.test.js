const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const ui = read('public', 'ui.js');
const css = read('public', 'css', 'components', 'ddev-menu.css');
const server = read('server.js');

test('the DDEV menu folds its groups, keeps the first and this project open, and is one column', () => {
  assert.match(ui, /function foldDdevMenus\(root\)/);
  assert.match(ui, /\/this project\/i\.test/);
  assert.match(ui, /setAttribute\('aria-expanded'/);
  assert.match(css, /\.act-menu-ddev \.ddev-nav-columns \{ column-count: 1; \}/);
  assert.match(css, /width: 18rem/);
});

test('a menu opened in the project list is drawn above the assistant and under the top bar', () => {
  assert.match(css, /#webship-workspace-projects:has\(\.uk-dropdown\.uk-open\) \{ position: relative; z-index: 35; \}/);
});

test('each workspace offers its create actions in its card, from the same entries as the rail', () => {
  assert.match(server, /What would you like to create\?/);
  assert.match(server, /pageActionGroups\(`workspace:\$\{key\}`\)\.find\(\(g\) => g\.id === 'create'\)/);
  assert.doesNotMatch(read('public', 'css', 'components', 'create-card.css'), /#[0-9a-fA-F]{3,8}\b/);
});
