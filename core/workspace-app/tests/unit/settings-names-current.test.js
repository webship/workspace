/**
 * What the dashboard, its commands and its docs call the places in Settings is what Settings shows (webship/workspace#685).
 *
 * Settings has no "Plugins" page any more: a plugin is added from Settings → Add a plugin, and each added plugin has a
 * tab of its own. The home page of a fresh workspace, General, the new-version tooltip, the dashboard's log, the CLI
 * and the docs still sent people to "Settings → Plugins". This reads the shipped tree and finds the old name nowhere.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..', '..');
const OLD = /Settings\s*(?:→|&rarr;|->)\s*Plugins\b/;

test('no shipped file sends anyone to "Settings → Plugins"', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'vendor'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p !== path.join(REPO, 'core', 'workspace-app', 'tests', 'unit')) walk(p); continue; }
      if (!/\.(js|md|sh|yml|yaml|css|feature|html)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      text.split('\n').forEach((l, i) => { if (OLD.test(l)) found.push(`${path.relative(REPO, p)}:${i + 1}`); });
    }
  };
  walk(REPO);
  assert.deepStrictEqual(found, []);
});

test('the Add a plugin tab is still called that, so the new name points somewhere', () => {
  const server = fs.readFileSync(path.join(REPO, 'core', 'workspace-app', 'server.js'), 'utf8');
  assert.match(server, /\{ id: 'plugins', label: 'Add a plugin',/);
  assert.match(server, /from <a href="\/settings\/plugins">Settings → Add a plugin<\/a>, or:/);
});
