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

test('the catalogue is rows by family: what is here says Added and leads to its page, the rest get a Require button', () => {
  const { catalogHtml } = require('../../plugins-page');
  const html = catalogHtml(new Map([['@webship.co/workspace-git', 'git']]));
  assert.match(html, /Catalogue/);
  assert.strictEqual((html.match(/<span>Added<\/span>/g) || []).length, 1, 'git is marked, once');
  assert.match(html, /<a class="plugin-row-main uk-link-reset" href="\/settings\/plugin\/git">/);
  assert.match(html, /"spec":"@webship\.co\/workspace-upsun"/, 'the rest get a Require button with the package to install');
  assert.match(html, /aria-label="Require Upsun">Require</, 'and the button names what it requires');
  assert.strictEqual((html.match(/<li class="plugin-row"/g) || []).length, catalog().length);
  // A plain Set of module names is still an answer (the first form this took).
  assert.strictEqual((catalogHtml(new Set(['@webship.co/workspace-git'])).match(/<span>Added<\/span>/g) || []).length, 1);
});

test('the AI folders are a family of their own, the platforms on npm are listed, and the avatar is a feature', () => {
  const by = Object.fromEntries(FAMILIES.map((f) => [f.id, f.plugins.map(([n]) => n)]));
  assert.deepStrictEqual(by.ai, ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts']);
  for (const p of ['drupal', 'drupal-cms', 'wordpress', 'joomla', 'typo3', 'odoo']) assert.ok(by.platforms.includes(p), p);
  assert.ok(by.features.includes('avatar') && !by.workspaces.includes('avatar'));
  assert.strictEqual(FAMILIES[0].id, 'platforms', 'platforms first, as Settings shows them');
});

test('the Plugins page is where a plugin is added: a labelled box, the catalogue under a filter, the commands of the core', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'plugins-page.js'), 'utf8');
  assert.match(src, /<label class="settings-search-label" for="plugin-require-spec">Require a package by name<\/label>/);
  assert.match(src, /<div class="settings-search" hidden>/);
  assert.match(src, /data-show="\$\{show\}"/);
  assert.match(src, /\$\{commandsSectionHtml\(\)\}/);
  assert.ok(!src.includes('plugin-card'), 'no card per plugin: a plugin that is here has a row on Settings and a page of its own');
  assert.ok(!src.includes('hx-confirm'), 'an unmet need is said on the step, not asked in a dialog');
});

test('a row of the catalogue stays short on a phone: the package line does not wrap', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'public', 'css', 'components', 'plugins-page.css'), 'utf8');
  const phone = css.slice(css.indexOf('@media (max-width: 40em)'));
  assert.match(phone, /\.plugin-catalog \.plugin-row-summary \{ white-space: nowrap; \}/);
});
