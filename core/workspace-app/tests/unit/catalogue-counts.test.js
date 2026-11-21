/**
 * The catalogue said "(29 added so far)" three lines above an "Added 28" chip: the sentence counted every
 * plugin here, the notes plugin the base ships among them, the chip only what came from the catalogue. And
 * it began "The base ships empty", which the shipped notes plugin contradicts.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(APP, 'plugins-page.js'), 'utf8');

test('the catalogue\'s sentence counts what its "Added" chip counts', () => {
  assert.match(src, /\$\{here \? ` \(\$\{here\} added from this catalogue so far\)` : ''\}/);
  assert.doesNotMatch(src, /\$\{list\.length\} added so far/);
  const html = require('../../plugins-page').pluginsPageHtml();
  const said = (html.match(/\((\d+) added from this catalogue so far\)/) || [])[1] || '0';
  const chip = (html.match(/data-show="active"[^>]*>Added <span class="settings-chip-count">(\d+)<\/span>/) || [])[1];
  assert.strictEqual(said, chip, 'the sentence and the chip disagree');
});

test('nothing says the base ships empty: it ships the notes plugin', () => {
  for (const f of ['plugins-page.js', 'settings-home.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(APP, f), 'utf8'), /The base ships empty/, f);
  }
  assert.match(src, /only Workspace notes ships with the base/);
});
