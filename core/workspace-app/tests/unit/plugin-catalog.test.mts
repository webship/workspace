/**
 * The catalogue: what the empty dashboard suggests and the Plugins page offers to require. Every
 * entry is an npm package of the one scope, named once, and the page marks what is already required.
 */
import assert from 'node:assert';
import { test } from 'node:test';

import { FAMILIES, SCOPE, catalog } from '../../plugin-catalog.mts';
import $plugins_page from '../../plugins-page.js';
import * as $settings_model from '../../settings-model.mts';
import * as $fs from 'node:fs';
import * as $path from 'node:path';

/** What this test uses of plugins-page.js, which is not TypeScript yet. */
interface PluginsPageView { catalogHtml(required?: Set<string> | Map<string, object>): string }

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

test('the catalogue\'s data is plugin-catalog.json, which the webship-workspace command reads as it is', () => {
  const file = $path.join(import.meta.dirname, '..', '..', 'plugin-catalog.json');
  const data = JSON.parse($fs.readFileSync(file, 'utf8')) as { scope: string; families: { id: string; label: string; about: string; plugins: string[][] }[] };
  assert.deepStrictEqual(Object.keys(data), ['scope', 'families']);
  assert.strictEqual(data.scope, SCOPE);
  assert.deepStrictEqual(data.families, FAMILIES);
  for (const f of data.families) for (const p of f.plugins) assert.strictEqual(p.length, 3, `${f.id}: ${p[0]} is [id, name, a line]`);
  // The module holds no list of its own, and the command reads the data, not the module.
  assert.doesNotMatch($fs.readFileSync($path.join(import.meta.dirname, '..', '..', 'plugin-catalog.mts'), 'utf8'), /\['[a-z0-9-]+', '/);
  const bin = $fs.readFileSync($path.join(import.meta.dirname, '..', '..', '..', 'bin', 'workspace.js'), 'utf8');
  assert.match(bin, /'workspace-app', 'plugin-catalog\.json'\)/);
  assert.doesNotMatch(bin, /plugin-catalog\.mts/);
});

test('the catalogue is rows by family: a name, the line that says what it does and a short id; nothing is cut, and what it needs is not here', () => {
  const { catalogHtml } = $plugins_page as unknown as PluginsPageView;
  const html = catalogHtml(new Set(['@webship.co/workspace-git']));
  assert.match(html, /Catalogue/);
  assert.strictEqual((html.match(/<span>Added<\/span>/g) || []).length, 1, 'git is marked, once');
  assert.match(html, /<a class="plugin-row-main uk-link-reset" href="\/settings\/plugin\/git">/);
  // The same short name as the Settings home, then what it does, then the id (the package is its title).
  assert.match(html, /<span class="plugin-row-name">Dev<\/span><span class="plugin-row-extra plugin-row-id" title="@webship\.co\/workspace-dev">dev<\/span><\/span>\s*<span class="plugin-row-summary">Development sites: the Drupal, Drupal CMS and Webship builders<\/span>/);
  assert.match(html, /<span class="plugin-row-name">Git<\/span>/);
  assert.ok(!html.includes('plugin-catalog-needs') && !/needs:/.test(html));
  assert.match(html, /"spec":"@webship\.co\/workspace-upsun"/, 'the rest get a button with the package to add');
  assert.match(html, /aria-label="Add Upsun">Add</, 'and the button names what it adds');
  assert.strictEqual((html.match(/<li class="plugin-row"/g) || []).length, catalog().length);
});

test('a plugin that is here shows the state it is in, not a green "Added" over something that is not installed', () => {
  const { catalogHtml } = $plugins_page as unknown as PluginsPageView;
  const model = $settings_model;
  const row = { name: 'cpanel', module: '@webship.co/workspace-cpanel', version: '1.0.0', manifest: { name: 'cpanel', label: 'cPanel' }, step: 1, wants: { unmet: [], problems: [] } };
  const p = model.groupByFamily([row])[0].plugins[0];
  const html = catalogHtml(new Map([[String(p.module), p]]));
  const at = html.indexOf('href="/settings/plugin/cpanel"');
  const li = html.slice(at, html.indexOf('</li>', at));
  assert.match(li, /<span>Not installed<\/span>/);
  assert.ok(!li.includes('<span>Added</span>'));
  assert.match(li, /plugin-row-chevron/, 'the row is the link; no second link beside it');
});

test('every plugin of the catalogue has a name and a line that is not its name or its package', () => {
  for (const p of catalog()) {
    assert.ok(p.label && p.summary, p.name);
    assert.notStrictEqual(p.summary.toLowerCase(), p.label.toLowerCase(), `${p.name}: the line repeats the name`);
    assert.ok(!p.summary.includes('@webship.co'), p.name);
    assert.ok(p.summary.length <= 110, `${p.name}: one line`);
  }
});

test('the AI folders are a family of their own, the platforms on npm are listed, and the avatar is a feature', () => {
  const by = Object.fromEntries(FAMILIES.map((f) => [f.id, f.plugins.map(([n]) => n)]));
  assert.deepStrictEqual(by.ai, ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts']);
  for (const p of ['drupal', 'drupal-cms', 'wordpress', 'joomla', 'typo3', 'odoo', 'laravel', 'symfony', 'codeigniter', 'woocommerce', 'bootstrap', 'mediawiki', 'moodle', 'django', 'nextjs', 'strapi', 'docusaurus', 'discourse', 'payload', 'filament', 'keycloak', 'nextcloud', 'spring-boot', 'aspnet-core', 'wagtail', 'phpbb', 'bbpress', 'mautic', 'penpot', 'buddypress', 'learnpress', 'opencart', 'openproject', 'roundcube', 'redmine']) assert.ok(by.platforms.includes(p), p);
  assert.ok(by.features.includes('avatar') && !by.workspaces.includes('avatar'));
  assert.strictEqual(FAMILIES[0].id, 'platforms', 'platforms first, as Settings shows them');
});

test('the databases family offers each engine, not the base they share, and Settings shows it as the catalogue does', () => {
  const by = Object.fromEntries(FAMILIES.map((f) => [f.id, f.plugins.map(([n]) => n)]));
  assert.deepStrictEqual(by.databases, ['mariadb', 'mysql', 'postgresql', 'sqlite']);
  assert.ok(!catalog().some((p) => p.name === 'database'), 'the base is a dependency of the engines, never a plugin of its own');
  const ids = FAMILIES.map((f) => f.id);
  assert.strictEqual(ids.indexOf('databases'), ids.indexOf('containers') + 1, 'after the container runtimes');
  const family = $settings_model.FAMILIES.find((f) => f.id === 'databases');
  assert.ok(family && family.label === 'Databases' && family.icon, 'Settings has the family, with its name and icon');
  for (const p of catalog().filter((e) => e.family === 'databases')) assert.match(p.summary, /tables and sizes/, `${p.name} says what its menu holds`);
});

test('the Plugins page is where a plugin is added: a labelled box, the catalogue under a filter, the commands of the base closed at the end', () => {
  const src = $fs.readFileSync($path.join(import.meta.dirname, '..', '..', 'plugins-page.js'), 'utf8');
  assert.match(src, /<label class="settings-search-label" for="plugin-require-spec">Add a package by name<\/label>/);
  assert.match(src, /<div class="settings-search" hidden>/);
  assert.match(src, /data-show="\$\{show\}"/);
  assert.match(src, /\$\{commandsSectionHtml\(\)\}/);
  assert.match(src, /<details class="plugin-commands-section">/);
  assert.match(src, /Needed by the builders that use DDEV, the default runtime/, 'DDEV is the default runtime, never the only one');
  assert.ok(!src.includes('plugin-card'), 'no card per plugin: a plugin that is here has a row on Settings and a page of its own');
  assert.ok(!src.includes('hx-confirm'), 'an unmet need is said on the step, not asked in a dialog');
});

test('a row of the catalogue wraps its line instead of cutting it, and an empty catalogue is not drawn', () => {
  const read = (f: string): string => $fs.readFileSync($path.join(import.meta.dirname, '..', '..', 'public', f), 'utf8');
  assert.match(read('css/components/settings-home.css'), /\.plugin-row-summary \{ white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; \}/);
  assert.ok(!/\.plugin-catalog \.plugin-row-summary \{ white-space: nowrap; \}/.test(read('css/components/plugins-page.css')));
  assert.match(read('ui.js'), /querySelectorAll\s*\('\.plugin-catalog-section'\)\.forEach\(\(g\) => \{ g\.hidden = /);
});

test('the catalogue offers only what is published: the four names that were never on npm are not in it, and no family is empty', () => {
  const names = catalog().map((p) => p.name);
  for (const gone of ['testing', 'webship-js', 'microsoft', 'apple']) assert.ok(!names.includes(gone), `${gone} is not offered until it is published`);
  for (const f of FAMILIES) assert.ok(f.plugins.length > 0, `${f.label} has something to add`);
  assert.ok(!FAMILIES.some((f) => f.id === 'drives'), 'a family with nothing published is not drawn');
});
