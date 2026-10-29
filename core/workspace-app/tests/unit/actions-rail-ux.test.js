const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'components', 'full-height-right-actions-rail-pages-that-have-actions.css'), 'utf8');

test('only the home page marks All workspaces as the current page', () => {
  assert.match(server, /navLink\(HOME_URL\(\), 'home', 'All workspaces', String\(context\) === 'home'\)/);
});

test('the two actions that write into ~/.claude go through the confirm dialog and say so', () => {
  assert.match(server, /sync\('install', 'push', 'Install all'.*into ~\/\.claude`, true\)/);
  assert.match(server, /sync\('update', 'refresh', 'Update installed'.*into ~\/\.claude whose source moved`, true\)/);
  assert.match(server, /hx-trigger="confirmed-remove"/);
  assert.match(server, /writes \? 'arm-step' : ''/);
});

test('the rail draws every entry in one stroke, and Go is a navigation landmark', () => {
  assert.match(server, /const RAIL_ICON_MAP = \{/);
  assert.match(server, /railIcons\(navItemHtml\(it\)\)/);
  assert.match(server, /aria-label="Workspace"/);
  assert.match(server, /aria-label="Page actions"/);
});

test('a group of one that repeats its heading is marked, and its heading is not drawn twice', () => {
  assert.match(server, /is-repeat/);
  assert.match(css, /\.actions-group\.is-repeat > \.actions-group-label \{ display: none; \}/);
});

test('collapsed tiles are named and have a tooltip that shows on focus as well as hover', () => {
  assert.match(ui, /setAttribute\('aria-label', name\)/);
  assert.match(ui, /setAttribute\('aria-description', hint\)/);
  assert.match(ui, /addEventListener\('focusin'/);
  assert.match(ui, /el\.removeAttribute\('title'\)/);
  assert.match(css, /#rail-tip \{/);
});

test('keyboard focus is a ring, the toggle stays in view, and the rail says when there is more', () => {
  assert.match(css, /\.actions-side \.action-btn:focus-visible \{\s*outline: 2px solid var\(--brand-primary\)/);
  assert.match(css, /\.actions-head \{\s*position: sticky;/);
  assert.match(css, /\.actions-side\.can-scroll \.actions-fade \{ opacity: 1; \}/);
  assert.match(ui, /classList\.toggle\('can-scroll'/);
});

test('no hex colour is added to the rail', () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![^{]*\})/);
  assert.doesNotMatch(css.slice(css.indexOf('#rail-tip')), /#[0-9a-fA-F]{6}\b/);
});

test('the confirm dialog still names the action once the rail has moved its title to the tooltip', () => {
  assert.match(ui, /btn\.getAttribute\('title'\) \|\| btn\.dataset\.tipHint \|\| btn\.textContent/);
});
