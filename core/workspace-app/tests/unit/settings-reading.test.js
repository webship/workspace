/**
 * Reading the Settings pages, from a design review: a plugin's description ran about 105 characters a line
 * (72ch is 720px in this face), as did the settings files' intros and the catalogue's; and the examples in
 * the Settings fields read as values already typed in ("@webship.co/workspace-jira" beside Add).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');

test('the long paragraphs of Settings are about 75 characters a line, measured in rem', () => {
  const css = read('public', 'css', 'components', 'settings-home.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.plugin-head-about \{ margin: 0\.5rem 0 0; max-width: 32rem; \}/);
  assert.match(css, /\.settings-family-about \{[^}]*max-width: 28rem; \}/);
  assert.match(css, /\.settings-card > p\.uk-text-meta \{ max-width: 30rem; \}/);
  assert.doesNotMatch(css, /max-width: 72ch/);
});

test('an example in a Settings field says it is one', () => {
  assert.match(read('settings-home.js'), /placeholder="e\.g\. jira, hosting, not installed"/);
  const page = read('plugins-page.js');
  assert.match(page, /placeholder="e\.g\. hosting, wordpress, jira"/);
  assert.match(page, /placeholder="e\.g\. \$\{SCOPE\}\/workspace-jira" required/);
});
