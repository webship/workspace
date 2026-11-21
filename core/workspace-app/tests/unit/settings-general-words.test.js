/**
 * General (settings.yml) called itself "settings.yml" on its own page, where its tile and its tab say
 * "General", and its first line still began "Hub settings: paths", though the file carries no paths.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('General is called General on its own page, as on its tile and its tab', () => {
  assert.match(server, /: current === 'settings\.yml' \? 'General'/);
});

test('its first line says what it holds, and no longer "paths"', () => {
  assert.doesNotMatch(server, /Hub settings: paths/);
  assert.match(server, /file === 'settings\.yml' \? 'The workspace name, the account installs use, who contributions are credited to, git forges and AI keys\.'/);
});
