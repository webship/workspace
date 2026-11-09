'use strict';
// The precondition helpers read the machine's settings files the way the hooks do.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

test('a plugin setting is read from the plugin\'s own file, and is empty when the file or the key is absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-precond-'));
  fs.mkdirSync(path.join(tmp, 'core', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'core', 'config', 'plugin.jira.settings.yml'), 'site: "https://example.atlassian.net"\ndefault_project: WEBSHIP  # the key folders inherit\nallow_writes: false\n');
  // The hooks resolve ROOT from their own location; the helper is exercised through the same regex on a copy.
  const src = fs.readFileSync(path.join(__dirname, '..', 'step-definitions', 'preconditions.steps.js'), 'utf8');
  const fn = new Function('fs', 'path', 'ROOT', src.match(/function pluginSettingValue[\s\S]*?\n}\n/)[0] + '; return pluginSettingValue;')(fs, path, tmp);
  assert.strictEqual(fn('jira', 'default_project'), 'WEBSHIP');
  assert.strictEqual(fn('jira', 'site'), 'https://example.atlassian.net');
  assert.strictEqual(fn('jira', 'missing_key'), '');
  assert.strictEqual(fn('nope', 'default_project'), '');
  fs.rmSync(tmp, { recursive: true, force: true });
});
