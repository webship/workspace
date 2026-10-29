const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const ui = read('public', 'ui.js');
const server = read('server.js');

test('a search box keeps its focus, caret and what was typed when its own results replace it', () => {
  assert.match(ui, /function keepTypingThroughSwaps\(\)/);
  assert.match(ui, /e\.detail && e\.detail\.ctx/);
  assert.match(ui, /field\.focus\(\{ preventScroll: true \}\)/);
  assert.match(ui, /if \(searched !== k\.value\) field\.dispatchEvent\(new KeyboardEvent\('keyup'/);
});

test('the comment above a key is read as its description', () => {
  const { rowsFromText } = require('../../settings-file');
  const rows = rowsFromText('# How long a run may take.\n# In minutes.\ntimeout: 10\nother: 1\n');
  assert.equal(rows[0].comment, 'How long a run may take. In minutes.');
  assert.equal(rows[1].comment, '');
});

test('a settings file has a find box, switches that say On or Off, and an unsaved marker', () => {
  assert.match(server, /class="uk-input settings-find"/);
  assert.match(server, /class="settings-switch" type="checkbox" role="switch"/);
  assert.match(server, /class="settings-dirty uk-text-meta" hidden>Unsaved changes/);
  assert.match(ui, /\.settings-find/);
  assert.match(ui, /addEventListener\('beforeunload'/);
});
