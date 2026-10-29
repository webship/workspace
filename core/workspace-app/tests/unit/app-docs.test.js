/**
 * The illustrated guide, and its images.
 *
 * A screenshot that has been renamed or moved leaves a broken image, and a broken
 * image in a guide is invisible to whoever wrote it and obvious to everybody else.
 * Thirty-six screenshots sat in this folder referenced by nothing at all before the
 * guide existed, which is the other half of the same problem.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const GUIDE = path.join(DOCS, 'README.md');

test('every image the guides link to is actually there', () => {
  const md = [GUIDE, path.join(DOCS, 'USER-GUIDE.md')].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const links = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 10, `expected the guide to be illustrated, found ${links.length} images`);
  for (const rel of links) {
    assert.ok(fs.existsSync(path.join(DOCS, rel)), `missing image: ${rel}`);
  }
});

test('every image has alt text', () => {
  // The guide is read on GitHub, in the repository, and by people who cannot see
  // the picture. An empty alt is a picture that says nothing to them.
  const md = fs.readFileSync(GUIDE, 'utf8');
  for (const m of md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    assert.ok(m[1].trim().length > 3, `no alt text for ${m[2]}`);
  }
});

test('the guide links to the other docs, and they exist', () => {
  const md = fs.readFileSync(GUIDE, 'utf8');
  const root = path.join(__dirname, '..', '..', '..', '..');
  for (const rel of ['docs/workspace-tips-and-rules.md', 'README.md']) {
    assert.match(md, new RegExp(rel.replace(/[/.]/g, '\\$&')), `the guide never points at ${rel}`);
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} does not exist`);
  }
  // The three documents point at each other, or the set is three orphans.
  for (const f of ['USER-GUIDE.md', 'DEVELOPER-GUIDE.md']) {
    assert.ok(fs.existsSync(path.join(DOCS, f)), `${f} is missing`);
    assert.match(md, new RegExp(f), `the index never points at ${f}`);
  }
});

test('/help reads the guide from the app docs, and can serve its images', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /APP_DOCS, 'USER-GUIDE\.md'/);
  // Relative image paths work in the repository; over HTTP they need the route.
  assert.match(src, /\/help\/screenshots\//);
  // And the route must be contained: this is a docs folder, not a second static root.
  assert.match(src, /realpathSync\(path\.join\(APP_DOCS, 'screenshots'\)\)/);
});

test('the README points at the guide, and says what it is', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8');
  assert.match(md, /core\/workspace-app\/docs/);
  // One "New here" callout, not two: the second was a duplicate of the first.
  assert.strictEqual((md.match(/New here/g) || []).length, 1);
});
