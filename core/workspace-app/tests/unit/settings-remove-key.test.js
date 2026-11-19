/**
 * removeSettingsKey: one dotted key out of a settings file, with everything under it, and the rest of
 * the file byte for byte (webship/workspace#493: plugins.sh --remove takes plugins.<name> out). A parent
 * left with nothing under it is an empty map, never a null.
 *
 * WORKSPACE_CONFIG is read when workspaces.js loads, so it is set before the require below.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-settings-remove-'));
process.env.WORKSPACE_CONFIG = TMP;
const yaml = require('js-yaml');
const { removeSettingsKey } = require('../../settings-file');

const write = (text) => { fs.writeFileSync(path.join(TMP, 'settings.yml'), text); return 'settings.yml'; };
const read = () => fs.readFileSync(path.join(TMP, 'settings.yml'), 'utf8');

const SETTINGS = `account:
  name: webmaster
# The plugins, in the order they were activated.
plugins:
  upsun:
    enabled: false
    module: "@webship.co/workspace-upsun"
    # its own settings are in plugin.upsun.settings.yml
  jira:
    enabled: true
    module: "@webship.co/workspace-jira"

workspaces:
  - dev
`;

test('a block in the middle goes, with its comment inside; the rest stays byte for byte', () => {
  write(SETTINGS);
  assert.strictEqual(removeSettingsKey('settings.yml', 'plugins.upsun'), 1);
  assert.strictEqual(read(), SETTINGS.replace(`  upsun:
    enabled: false
    module: "@webship.co/workspace-upsun"
    # its own settings are in plugin.upsun.settings.yml
`, ''));
  assert.deepStrictEqual(Object.keys(yaml.load(read()).plugins), ['jira']);
});

test('the last block of a parent leaves an empty map, and the blank line after it stays', () => {
  write(SETTINGS);
  removeSettingsKey('settings.yml', 'plugins.upsun');
  assert.strictEqual(removeSettingsKey('settings.yml', 'plugins.jira'), 1);
  const after = read();
  assert.match(after, /^plugins: \{\}\n\nworkspaces:\n  - dev\n$/m);
  assert.deepStrictEqual(yaml.load(after).plugins, {});
  assert.match(after, /^# The plugins, in the order they were activated\.$/m, 'the comment above the parent stays');
});

test('a key that is not there changes nothing', () => {
  write(SETTINGS);
  assert.strictEqual(removeSettingsKey('settings.yml', 'plugins.nope'), 0);
  assert.strictEqual(removeSettingsKey('settings.yml', 'nothing.here'), 0);
  assert.strictEqual(read(), SETTINGS);
});

test('a flow-style block and a top-level key go too', () => {
  write('plugins:\n  dev: { enabled: false }\n  git:\n    enabled: true\nextra: 1\n');
  removeSettingsKey('settings.yml', 'plugins.dev');
  assert.strictEqual(read(), 'plugins:\n  git:\n    enabled: true\nextra: 1\n');
  removeSettingsKey('settings.yml', 'extra');
  assert.strictEqual(read(), 'plugins:\n  git:\n    enabled: true\n');
});
