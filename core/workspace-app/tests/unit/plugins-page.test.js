const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { stepOf, needsInstall, STEPS } = require('../../plugins-page');
const { ROOT } = require('../../workspaces');

test('the four steps, in order, and a plugin with nothing to place is installed by being required', () => {
  assert.deepStrictEqual(STEPS, ['required', 'activated', 'installed', 'configured']);
  const bare = { name: 'notes', manifest: { name: 'notes' } };
  assert.strictEqual(stepOf(bare, undefined, undefined), 0, 'not activated');
  assert.strictEqual(stepOf(bare, { enabled: true }, undefined), 3, 'nothing to install, nothing to configure: ready');
  assert.strictEqual(needsInstall({}), false);
  assert.strictEqual(needsInstall({ scripts: { functions: ['f.sh'] } }), true);
  assert.strictEqual(needsInstall({ ddev: { compose: ['c.yaml'] } }), true);
  assert.strictEqual(needsInstall({ settingsTemplate: 'config/x.yml' }), true);
});

test('a plugin that ships files waits for the install, then for its settings file to lose CHANGE_ME', () => {
  const p = { name: 'x-cloud', manifest: { name: 'x-cloud', settingsFile: 'plugin.x-cloud.nowhere.settings.yml', settingsTemplate: 'config/t.yml' } };
  assert.strictEqual(stepOf(p, { enabled: 'true' }, { installed: false }), 1, 'activated, not installed');
  assert.strictEqual(stepOf(p, { enabled: true }, { installed: true }), 2, 'installed, no settings file yet');
});

test('the installer records against the workspace root the dashboard knows, not against its own folder', () => {
  const { RECORD } = require('../../plugin-install');
  assert.strictEqual(RECORD, path.join(ROOT, 'core', 'config', 'plugins.installed.yml'));
});

test('a placeholder is found bare, quoted or inside a longer value, and a comment that mentions it is not one', () => {
  const { hasPlaceholder } = require('../../plugins-page');
  assert.strictEqual(hasPlaceholder('username: CHANGE_ME\n'), true);
  assert.strictEqual(hasPlaceholder('default_project: "CHANGE_ME"\n'), true, 'quoted');
  assert.strictEqual(hasPlaceholder("site: 'https://CHANGE_ME.atlassian.net'\n"), true, 'inside a value');
  assert.strictEqual(hasPlaceholder('git:\n  github:\n    token: CHANGE_ME  # from the forge\n'), true, 'nested, with a comment after it');
  assert.strictEqual(hasPlaceholder('# Leave CHANGE_ME to skip it\nhost: github.com\n'), false, 'a comment is not a value');
  assert.strictEqual(hasPlaceholder('host: github.com  # not CHANGE_ME any more\n'), false);
  assert.strictEqual(hasPlaceholder(''), false);
});
