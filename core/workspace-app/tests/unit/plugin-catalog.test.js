/**
 * The catalogue: what the empty dashboard suggests and the Plugins page offers to require. Every
 * entry is an npm package of the one scope, named once, and the page marks what is already required.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { FAMILIES, SCOPE, catalog } = require('../../plugin-catalog');

test('every catalogue entry is an @webship.co/workspace-<name> package, named once, in a family that says what it is for', () => {
  assert.strictEqual(SCOPE, '@webship.co');
  const all = catalog();
  assert.ok(all.length >= 50, `${all.length} plugins`);
  const names = all.map((p) => p.name);
  assert.strictEqual(new Set(names).size, names.length, 'no plugin is listed twice');
  for (const p of all) {
    assert.match(p.name, /^[a-z0-9-]+$/);
    assert.strictEqual(p.module, `${SCOPE}/workspace-${p.name}`);
    assert.ok(p.label && p.familyLabel);
  }
  for (const f of FAMILIES) assert.ok(f.about && f.plugins.length, `${f.id} says what it is for and holds plugins`);
  for (const must of ['dev', 'github', 'upsun', 'lando', 'git', 'ide', 'drupal-modules']) assert.ok(names.includes(must), `${must} is in the catalogue`);
});

test('the Plugins page marks what is already required and offers the rest', () => {
  const { catalogHtml } = require('../../plugins-page');
  const html = catalogHtml(new Set(['@webship.co/workspace-git']));
  assert.match(html, /Catalogue/);
  assert.ok((html.match(/<span class="uk-label">required<\/span>/g) || []).length === 1, 'git is marked required, once');
  assert.match(html, /"spec":"@webship\.co\/workspace-upsun"/, 'the rest get a Require button with the package to install');
});
