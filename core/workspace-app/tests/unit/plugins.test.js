/**
 * The plugin loader: settings decide what loads, namespacing decides what it may touch.
 *
 * A plugin that fails these contracts fails at startup for whoever wrote it — but the loader
 * itself failing would take every plugin's surface off the dashboard at once, so its promises
 * (enabled-only, name rules, namespaced routes, per-workspace scoping) get pinned here.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { pluginActions, pluginPageActionGroups, loadedPlugins } = require('../../plugin-loader');
const { loadSettings, loadWorkspaces } = require('../../workspaces');

const enabled = Object.entries(loadSettings().plugins || {})
  .filter(([, c]) => c && (c.enabled === true || String(c.enabled) === 'true'))
  .map(([name]) => name);

test('every enabled plugin with a local folder loads', () => {
  for (const name of enabled) {
    const fs = require('fs');
    const path = require('path');
    const local = path.join(__dirname, '..', '..', 'plugins', name, 'index.js');
    if (!fs.existsSync(local)) continue; // module: plugins may not be installed here
    assert.ok(loadedPlugins.some((p) => p.name === name), `${name} is enabled but did not load`);
  }
});

test('plugin actions are namespaced under their own name', () => {
  for (const route of Object.keys(pluginActions)) {
    const m = route.match(/^\/actions\/p\/([a-z0-9-]+)\/[a-z0-9-]+$/);
    assert.ok(m, `${route} is not /actions/p/<plugin>/<action>`);
    assert.ok(loadedPlugins.some((p) => p.name === m[1]), `${route} belongs to an unloaded plugin`);
  }
});

test('page action groups render without throwing for every workspace page', () => {
  const workspaces = loadWorkspaces();
  for (const [key, meta] of Object.entries(workspaces)) {
    const groups = pluginPageActionGroups('workspace', key, meta);
    for (const group of groups) {
      assert.ok(group.label, 'a plugin rail group has a label');
      assert.ok(Array.isArray(group.items) && group.items.length, `${group.label} has items`);
    }
  }
});

test('workspace-notes respects its workspaces scoping when loaded', () => {
  if (!loadedPlugins.some((p) => p.name === 'workspace-notes')) return;
  const config = (loadSettings().plugins || {})['workspace-notes'] || {};
  const list = String(config.workspaces || '').split(',').map((w) => w.trim()).filter(Boolean);
  const workspaces = loadWorkspaces();
  for (const [key, meta] of Object.entries(workspaces)) {
    const has = pluginPageActionGroups('workspace', key, meta).some((g) => g.label === 'Notes');
    const expected = list.length === 0 || list.includes(key);
    assert.equal(has, expected, `Notes on ${key}: expected ${expected}`);
  }
});
