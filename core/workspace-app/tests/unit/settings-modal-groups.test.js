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
  assert.match(ui, /closest\('\.tabmodal \.settings-home a\[href\^="\/settings\/"\]'\)/);
  assert.match(ui, /where\.startsWith\('\/settings\/plugin\/'\) \? `plugin-\$\{/);
  assert.match(ui, /e\.metaKey \|\| e\.ctrlKey/, 'a click that asks for a new tab is left to the browser');
});

test('a tab opens at its top, whatever the scroll of the tab before it', () => {
  const ui = read('public/ui.js');
  assert.match(ui, /closest\('\.tabmodal-tab'\);\s*const pane = tab && tab\.closest\('\.tabmodal'\)\.querySelector\('\.tabmodal-pane'\);\s*if \(pane\) pane\.scrollTop = 0;/);
});
