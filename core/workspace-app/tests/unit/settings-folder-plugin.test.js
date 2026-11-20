/**
 * The plugin the base ships as a folder (plugins/workspace-notes) said nothing about itself in Settings
 * ("No description", a name made from its id) and offered a Remove whose text promised
 * `npm uninstall workspace-notes`, for a plugin that is no npm package at all.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const model = require('../../settings-model');
const page = require('../../settings-plugin-page');
const { installedPlugins } = require('../../plugin-manifest');

const NOTES = path.join(__dirname, '..', '..', 'plugins', 'workspace-notes', 'package.json');

test('the notes plugin the base ships says what it is: a name, one line and its family', () => {
  const pkg = JSON.parse(fs.readFileSync(NOTES, 'utf8'));
  const m = pkg.workspacePlugin;
  assert.strictEqual(m.name, 'workspace-notes');
  assert.strictEqual(m.label, 'Workspace notes');
  assert.ok(m.summary && m.summary.length <= 80, 'one short line under its name');
  assert.strictEqual(m.family, 'features');
  // No package name: a folder is no npm package, and a name would send the update check to npm for an
  // unrelated package that happens to be called that.
  assert.strictEqual(pkg.name, undefined);
  const notes = installedPlugins().find((p) => p.name === 'workspace-notes');
  assert.ok(notes, 'listed from its folder');
  assert.ok(!notes.module, 'no module to ask npm about');
  assert.strictEqual(notes.spec, 'plugins/workspace-notes');
  assert.strictEqual(model.summaryOf(notes), m.summary, 'Settings shows its line, not "No description"');
  assert.strictEqual(model.nameOf(notes), 'Workspace notes');
});

const folderPlugin = (step) => model.groupByFamily([{ name: 'workspace-notes', module: undefined, spec: 'plugins/workspace-notes', version: '',
  manifest: { name: 'workspace-notes', label: 'Workspace notes', summary: 'A NOTES.md in each workspace folder' }, step,
  wants: { needs: [], suggests: [], unmet: [], problems: [] }, placed: {} }])[0].plugins[0];

test('a folder plugin is said to be a folder of the dashboard, and offers no removal it cannot do', () => {
  const p = folderPlugin(0);
  assert.strictEqual(page.steps(p)[0].text, 'It is a folder of the dashboard: plugins/workspace-notes.');
  const html = page.removeHtml(p);
  assert.doesNotMatch(html, /npm uninstall/, 'no npm line for what is not a package');
  assert.doesNotMatch(html, /hx-post/, 'no Remove button: --remove leaves the folder, and the plugin with it');
  assert.match(html, /is a folder of the dashboard, not an npm package, so there is nothing to remove/);
});

test('an npm plugin keeps its package line and its Remove', () => {
  const p = model.groupByFamily([{ name: 'jira', module: '@webship.co/workspace-jira', spec: '^1.0.0', version: '1.0.13',
    manifest: { name: 'jira', label: 'Jira' }, step: 0, wants: { needs: [], suggests: [], unmet: [], problems: [] }, placed: {} }])[0].plugins[0];
  assert.match(page.steps(p)[0].text, /^The package is in the dashboard: @webship\.co\/workspace-jira 1\.0\.13\.$/);
  const html = page.removeHtml(p);
  assert.match(html, /npm uninstall @webship\.co\/workspace-jira/);
  assert.match(html, /hx-post="\/actions\/plugins"/);
});
