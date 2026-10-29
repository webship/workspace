/**
 * Reading the changelogs in products/.
 *
 * The parser's job is to be right about files nobody wrote for it. Three formats are in the tree
 * and each is tested on its own shape, because a reader that works for the products somebody
 * remembered is a reader people stop trusting the first time a version is missing.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  parseChangelog, kindOf, looksLikeVersion, listChangelogs, changelogFor, releasesFor, changelogIndex,
} = require('../../changelog');

/* ---------------- the formats ---------------- */

test('Keep a Changelog: version, date, and the kind from the section', () => {
  const [rel] = parseChangelog(`# Changelog

## [1.0.3] - 2026-09-14
### Added
- Add a Newsletter Canvas page at \`/newsletter\`

### Fixed
- Give the footer Subscribe button a link destination
`);
  assert.equal(rel.version, '1.0.3');
  assert.equal(rel.date, '2026-09-14');
  assert.deepEqual(rel.entries.map((e) => e.kind), ['Added', 'Fixed']);
  assert.deepEqual(rel.entries.map((e) => e.tone), ['success', 'danger']);
});

// The bug this was written for: the date separator used to match any dash, so `# 11.0.0-rc1` parsed
// as version `11.0.0` with `rc1` where the date goes — and a file with six releases showed three of
// them called 11.0.0. The separator has to be surrounded by whitespace.
test('a version with a suffix keeps its suffix', () => {
  const releases = parseChangelog(`# 11.0.0
- task: something

# 11.0.0-rc1
- task: something else

# 11.0.0-beta2
- task: a third thing
`);
  assert.deepEqual(releases.map((r) => r.version), ['11.0.0', '11.0.0-rc1', '11.0.0-beta2']);
  assert.deepEqual(releases.map((r) => r.date), ['', '', '']);
});

test('the old Drupal .txt: a title line underlined with dashes', () => {
  const releases = parseChangelog(`Menu Position 7.x-1.1, 2012-02-22
---------------------------------
- #1439948 by reglogge: form validation fails

Menu Position 7.x-1.0, 2011-11-01
---------------------------------
- by davereid: rowCount does not work on sqlite
`);
  assert.equal(releases.length, 2);
  assert.equal(releases[0].version, 'Menu Position 7.x-1.1');
  assert.equal(releases[0].date, '2012-02-22');
  assert.equal(releases[1].date, '2011-11-01');
});

test('a prefix on the entry beats the section it sits under', () => {
  // These files disagree with themselves in practice — a `fix:` often lives under `### Added` —
  // and the prefix is the more specific statement.
  const [rel] = parseChangelog(`## [1.0.0] - 2026-01-01
### Added
- fix: [#1](https://example.com) this is really a fix
- feat: and this is really a feature
`);
  assert.deepEqual(rel.entries.map((e) => e.kind), ['Fixed', 'Added']);
  // The prefix is consumed, not left in the text.
  assert.ok(!rel.entries[0].text.startsWith('fix:'), rel.entries[0].text);
});

test('a hard-wrapped entry is one entry, not four', () => {
  const [rel] = parseChangelog(`## [1.0.0] - 2026-01-01
### Fixed
- fix: a finding that runs
  across three
  separate lines
`);
  assert.equal(rel.entries.length, 1);
  assert.match(rel.entries[0].text, /runs across three separate lines/);
});

test('the Varbase shape: a release is grouped by package', () => {
  const [rel] = parseChangelog(`# 11.0.0
### At a glance
* The suite reaches its first stable release.

#### Varbase Starter 1.0.1
- fix: something in the starter

#### Educare 1.0.1
- feat: something in educare
`);
  assert.equal(rel.version, '11.0.0');
  assert.deepEqual(rel.entries.map((e) => e.group),
    ['At a glance', 'Varbase Starter 1.0.1', 'Educare 1.0.1']);
});

test('markdown is kept, because the reader must not show less than the file', () => {
  const [rel] = parseChangelog(`## [1.0.0] - 2026-01-01
- fix: [#3622817](https://www.drupal.org/i/3622817) a thing in \`config/optional\`
`);
  assert.match(rel.entries[0].text, /\[#3622817\]\(https:\/\/www\.drupal\.org\/i\/3622817\)/);
  assert.match(rel.entries[0].text, /`config\/optional`/);
});

/* ---------------- the small pieces ---------------- */

test('a kind maps to a label and a UIkit tone, whichever vocabulary it is written in', () => {
  assert.deepEqual(kindOf('Added'), { label: 'Added', tone: 'success' });
  assert.deepEqual(kindOf('feat'), { label: 'Added', tone: 'success' });
  assert.deepEqual(kindOf('fix'), { label: 'Fixed', tone: 'danger' });
  assert.deepEqual(kindOf('Security'), { label: 'Security', tone: 'danger' });
  assert.equal(kindOf('At a glance'), null, 'prose is not a kind');
  assert.equal(kindOf(''), null);
});

test('a heading is a version or it is prose', () => {
  for (const v of ['1.0.3', '11.0.0-rc1', '8.x-1.1', 'Unreleased', 'v2.3']) {
    assert.ok(looksLikeVersion(v), `${v} is a version`);
  }
  for (const p of ['At a glance', 'Changelog', 'Stability of Varbase 11.0.0', 'Added']) {
    assert.ok(!looksLikeVersion(p), `${p} is not a version`);
  }
});

test('an empty file, and a file of nothing but prose, are no releases rather than a crash', () => {
  assert.deepEqual(parseChangelog(''), []);
  assert.deepEqual(parseChangelog('# Changelog\n\nAll notable changes are documented here.\n'), []);
});

/* ---------------- against the real tree ---------------- */

test('a changelog anywhere in the tree is found, not only in products/', () => {
  const found = listChangelogs();
  assert.ok(found.length > 0, 'nothing in the tree keeps a changelog');
  for (const c of found) {
    assert.match(c.file, /^CHANGELOG\.(md|txt)$/i);
    assert.ok(c.bytes > 0);
    assert.ok(c.workspace, 'every entry names the workspace it was found in');
  }
  // The point of the change: it is a walk of every workspace, not a list of one.
  const workspaces = new Set(found.map((c) => c.workspace));
  assert.ok(workspaces.size > 1,
    `only ${[...workspaces]} was walked — a built site in dev/ keeps one too`);
});

test('a name that climbs out of its workspace is refused', () => {
  for (const bad of ['../etc', '..', 'a/b', 'no-such-item-here']) {
    assert.equal(changelogFor('products', bad), null, `products/${bad} should not resolve`);
    assert.equal(releasesFor('products', bad), null);
  }
  // And a workspace that is not one.
  assert.equal(changelogFor('../../etc', 'passwd'), null);
  assert.equal(changelogFor('no-such-workspace', 'x'), null);
});

test('the index summarises everything without throwing on any of it', () => {
  const rows = changelogIndex();
  assert.equal(rows.length, listChangelogs().length);
  for (const r of rows) {
    assert.equal(typeof r.releases, 'number');
    assert.equal(typeof r.entries, 'number');
    assert.ok(r.workspace);
    // The newest release is the first in the file, never "Unreleased" — a version people can install.
    assert.ok(!/^unreleased$/i.test(r.latest), `${r.label} reports Unreleased as its latest`);
  }
});
