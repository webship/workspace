/**
 * The version in the rail links to its own release page.
 *
 * The one thing that must not drift: the URL comes from `sources: tooling:` in settings.yml, never a
 * hardcoded github.com/webship/workspace. A fork, a mirror or a self-hosted GitLab has to land on its
 * own release page — and nothing here should hardcode what configuration already knows.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const { sourceOf, appVersion } = require(path.join(app, 'workspaces'));

test('the release URL is built from the configured source, not a hardcoded repo', () => {
  const row = versionEntry();
  assert.match(row, /sourceOf\('tooling', 'host', 'github\.com'\)/);
  assert.match(row, /sourceOf\('tooling', 'repo', ''\)/);
  assert.match(row, /https:\/\/\$\{host\}\/\$\{repo\}\/releases\/tag\/\$\{encodeURIComponent\(v\)\}/);
  assert.ok(!/github\.com\/Vardot\/workspace\/releases/.test(server), 'the repo must not be hardcoded');
});

// To the end of the entry, not a fixed number of characters: the comments around it grow, and a window
// one character short reads as the markup having been taken away.
function versionEntry() {
  const from = server.indexOf('// The release page for this tag');
  return server.slice(from, server.indexOf('})(),', from));
}

test('a tree with no stamp gets plain text, not a link to nowhere', () => {
  const row = versionEntry();
  assert.match(row, /const href = v && repo \?/, 'no version or no repo means no link');
  assert.match(row, /: `<span class="action-btn actions-version is-unknown"/);
});

test('it opens in a new tab, safely', () => {
  const row = versionEntry();
  assert.match(row, /target="_blank" rel="noopener"/, 'a rail link that replaced the dashboard would be a trap');
});

test('the settings this reads are actually there', () => {
  // If `sources: tooling:` ever loses these keys the link silently stops being built.
  assert.ok(sourceOf('tooling', 'repo', ''), 'settings.yml must carry sources.tooling.repo');
  assert.match(sourceOf('tooling', 'host', 'github.com'), /\./);
  const v = appVersion();
  if (v) assert.match(v, /^[0-9]/, 'a stamp is a version');
});
