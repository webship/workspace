/**
 * The settings modal follows the Settings home: the base, the way to add a plugin, then the plugins
 * that are here by family, each opening its own page. An address kept from before still opens.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const server = read('server.js');
const groups = server.slice(server.indexOf('function settingsTabGroups'), server.indexOf('async function settingsPage'));

test('the modal starts with the base and an overview, then a group per family with a tab per plugin', () => {
  assert.match(groups, /id: 'base', label: 'Workspace base'/);
  assert.match(groups, /id: 'overview', label: 'Overview', icon: 'tabler:list-search', url: '\/settings\?fragment=1'/);
  for (const id of ['navigation', 'buttons', 'command-order', 'styles', 'plugins']) assert.ok(groups.includes(`id: '${id}'`), id);
  assert.match(groups, /data\.groups\.map\(\(g\) => \(\{ id: `family-\$\{g\.id\}`, label: g\.label/);
  assert.match(groups, /id: `plugin-\$\{p\.name\}`[\s\S]{0,200}url: `\/settings\/plugin\/\$\{encodeURIComponent\(p\.name\)\}\?fragment=1`/);
  assert.match(groups, /badge: p\.state\.id !== 'ready' \? p\.state\.label : p\.state\.update \? `Update \$\{p\.state\.update\}` : ''/,
    'a plugin that wants something says what on its tab: its state, or the newer version; a ready plugin with an update does not say Ready');
  assert.ok(!groups.includes("'style-files'"), 'no tab per theme file: the styles are one entry');
  assert.match(server, /groups: settingsTabGroups\(tab\), active: tab \|\| 'overview'/);
});

test('a file that has no tab of its own any more still opens from an address kept from before', () => {
  assert.match(groups, /if \(wanted && !has\(wanted\) && data\.files\.includes\(wanted\)\)/);
  assert.match(groups, /id: 'file', label: 'This file'/);
});

test('inside the modal a link of the overview opens the tab of the same thing', () => {
  const ui = read('public/ui.js');
  assert.match(ui, /closest\s*\('\.tabmodal \.settings-home a\[href\^="\/settings\/"\]'\)/);
  assert.match(ui, /where\.startsWith\('\/settings\/plugin\/'\) \? `plugin-\$\{/);
  assert.match(ui, /e\.metaKey \|\| e\.ctrlKey/, 'a click that asks for a new tab is left to the browser');
});

test('a tab opens at its top, whatever the scroll of the tab before it', () => {
  const ui = read('public/ui.js');
  assert.match(ui, /closest\s*\('\.tabmodal-tab'\);\s*const pane = tab && tab\.closest\('\.tabmodal'\)\s*\.querySelector\s*\('\.tabmodal-pane'\);\s*if \(pane\) pane\.scrollTop = 0;/);
});

test('the modal takes focus into the dialog when it opens and gives it back to what opened it', () => {
  const ui = read('public/ui.js');
  assert.match(ui, /let editorModalOpener = null;/);
  assert.match(ui, /dialog\.tabIndex = -1;\s*dialog\.focus\(\{ preventScroll: true \}\);/);
  assert.match(ui, /if \(opener && opener\.isConnected\) setTimeout\(\(\) => \{ try \{ opener\.focus\(\); \}/);
});

test('modal tabs: the panel is not a live region, a tab says its badge and its group apart from its name, the filter says what is left', () => {
  const { tabModalHtml } = require('../../tab-modal.mts');
  const html = tabModalHtml({ id: 'settings', title: 'Settings', filter: true, groups: [
    { id: 'family-platforms', label: 'Platforms', tabs: [{ id: 'plugin-drupal', label: 'Drupal', url: '/x', badge: 'Needs settings', badgeTone: 'warning' }, { id: 'plugin-odoo', label: 'Odoo', url: '/y', badge: 'Not active' }] }] });
  assert.ok(!html.includes('aria-live'), 'a 5,000-character panel is not read out on every tab change');
  assert.match(html, /<span class="tabmodal-tab-label">Drupal<\/span><span class="uk-hidden-visually">, <\/span><span class="tabmodal-badge is-warning">Needs settings<\/span><span class="uk-hidden-visually">, Platforms<\/span>/);
  assert.match(html, /<span class="tabmodal-badge">Not active<\/span>/, 'not a blocker: the quiet badge');
  assert.match(html, /<p class="tabmodal-group-label" aria-hidden="true">Platforms<\/p>/);
  assert.match(html, /aria-describedby="tm-settings-filter-status"/);
  assert.match(html, /<p class="tabmodal-filter-status" id="tm-settings-filter-status" role="status" data-total="2"><\/p>/);
  assert.match(html, /<h2 class="tabmodal-heading">Drupal<\/h2>/, 'the pane heading is level with "Settings", so the sections under it are below it');
  assert.match(read('public/ui.js'), /`\$\{shown\} of \$\{status\.dataset\.total\} shown\.` : 'Nothing matches\.'/);
  assert.match(groups, /badgeTone: p\.state\.attention \? 'warning' : ''/);
  assert.match(groups, /hint: p\.summary \|\| '',/, 'the line under the pane heading is what the plugin is, not its package a second time');
});

test('the overview tab says what it now is, and a long tab name wraps instead of being cut', () => {
  assert.match(groups, /id: 'overview'[^\n]*hint: 'What is waiting: the plugins that need something, and the newer versions on npm'/);
  assert.match(read('public/css/components/tab-modal.css'), /\.tabmodal-tab \.tabmodal-tab-label \{ white-space: normal;/);
});
