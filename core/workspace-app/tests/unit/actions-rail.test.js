/**
 * The actions rail's Go list.
 *
 * Rows management — the buttons a project row carries, what is inside them, and the actions on them — is a tab of the
 * Commands page, so arranging the row you are looking at was three clicks away. Go carries it as **Action buttons**,
 * between All workspaces and Commands, on every page.
 *
 * Writing a command is not a per-workspace action either: Commands → New scaffolds the same cmd-*.sh and asks which
 * workspace it belongs to, so the workspace rail no longer repeats it.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('Action buttons sits between All workspaces and Commands, and points at rows management', () => {
  const go = src.slice(src.indexOf("groups.push({ id: 'go', label: 'Go'"), src.indexOf("navLink('/help'"));
  const order = [...go.matchAll(/navLink\(HOME_URL\(\), 'home', 'All workspaces'|navLink\('\/settings\/buttons'|navLink\('\/commands'/g)].map((m) => m[0]);
  assert.deepStrictEqual(order, ["navLink(HOME_URL(), 'home', 'All workspaces'", "navLink('/settings/buttons'", "navLink('/commands'"]);
  assert.match(go, /navLink\('\/settings\/buttons', 'tabler:layout-grid', 'Action buttons', onButtons/);
});

test('the Buttons page is marked in Go, and still offered the Commands actions', () => {
  // Buttons moved out of Commands and under Settings: what a project row offers is configuration.
  assert.match(src, /const onButtons = String\(context\) === 'settings:buttons';/);
  assert.match(src, /const ctx = String\(context\) === 'settings:buttons' \? 'settings' : String\(context\);/,
    'the Buttons page gets the Settings groups, not an empty rail');
  assert.match(src, /settingsPage\('buttons', readPageState\(req\), \{ fragment: isFragment\(req\) \}\)/, 'the page says which it is');
  assert.match(src, /function commandsShell\(title, subtitle, active, body, context = 'commands'\)/);
});

test('writing a command lives with the commands, not on every workspace page', () => {
  const groups = src.slice(src.indexOf('function pageActionGroups(context) {'), src.indexOf('function pageActionsHtml'));
  assert.doesNotMatch(groups, /label: 'New commands'/, 'the workspace rail no longer repeats it');
  const commandsPage = src.slice(src.indexOf("if (ctx === 'commands') {"), src.indexOf("groups.push({ id: 'go', label: 'Go'"));
  assert.match(commandsPage, /'New command'/);
  assert.match(commandsPage, /'Generate script with AI'/);
});

test('no page is left behind: the Actions page and its route are gone', () => {
  assert.doesNotMatch(src, /function actionsPage\(/);
  assert.doesNotMatch(src, /pathname === '\/actions' \|\| pathname === '\/actions\/'/);
  assert.match(src, /if \(req\.method === 'POST' && pathname\.startsWith\('\/actions\/'\)\)/, 'the action namespace is untouched');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.doesNotMatch(ui, /actions-jump/);
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'full-height-right-actions-rail-pages-that-have-actions.css'), 'utf8');
  assert.doesNotMatch(css, /actions-page/);
});
