/**
 * Settings home: the base as a few entries, the plugins as rows by family with a state in words and
 * one action, a filter that is hidden until a script shows it, and honest empty states.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const model = require('../../settings-model');
const home = require('../../settings-home');

const none = { unmet: [], problems: [] };
const plugin = (name, manifest, step, more = {}) => ({ name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name, ...manifest }, step, wants: none, ...more });
const plugins = [
  plugin('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml' }, 2),
  plugin('wordpress', { label: 'WordPress' }, 1, { wants: { unmet: [{ anyOf: ['dev', 'test'], pick: 'dev' }], problems: [] } }),
  plugin('dev', { label: 'Dev', workspace: { key: 'dev' } }, 3),
  plugin('lando', { label: 'Lando' }, 0),
];
const files = ['settings.yml', 'style.yml', 'theme.default.yml', 'theme.slate.yml', 'plugin.jira.settings.yml', 'workspace.dev.settings.yml', 'workspace.handmade.settings.yml'];
const html = home.homeHtml({ files, plugins, groups: model.groupByFamily(plugins), folders: { handmade: { label: 'Handmade', subtitle: 'A folder made by hand' } }, styles: { count: 2, wearing: 'Webship' } });

test('the base is five entries, and the styles are one of them: no tile per theme file', () => {
  const base = html.slice(html.indexOf('settings-base'), html.indexOf('settings-plugins'));
  assert.strictEqual((base.match(/class="settings-tile"/g) || []).length, 5);
  for (const href of ['/settings/settings.yml', '/settings/navigation', '/settings/buttons', '/settings/command-order', '/settings/styles']) assert.ok(base.includes(`href="${href}"`), href);
  assert.ok(!html.includes('href="/settings/theme.slate.yml"'), 'a theme file is reached from Styles');
  assert.match(base, /2 styles · wearing Webship/);
  assert.ok(!html.includes('paths, the install account, contributor identity and API keys'), 'the one hint that was on every file is gone');
});

test('every plugin is a row in its family: a link to its page, its state in words, one action', () => {
  assert.strictEqual((html.match(/<li class="plugin-row" /g) || []).length, 4);
  for (const f of ['platforms', 'folders', 'containers', 'features']) assert.ok(html.includes(`data-family="${f}"`), f);
  assert.ok(!html.includes('data-family="hosting"'), 'a family with no plugin is not drawn');
  assert.ok(html.includes('href="/settings/plugin/jira"'));
  for (const label of ['Needs settings', 'Not installed', 'Ready', 'Not active']) assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.match(html, /href="\/settings\/plugin\/jira#settings" aria-label="Configure Jira">Configure</);
  assert.match(html, /4 added · 1 ready · 2 need attention · 1 not active/);
});

test('a step with an unmet need says what is added and runs with --with-needs; the command is on the button', () => {
  const row = html.slice(html.indexOf('data-state="not-installed"'));
  assert.match(row, /Install with dev</);
  assert.match(row, /&quot;withNeeds&quot;:&quot;1&quot;/);
  assert.match(row, /title="bash core\/scripts\/plugins\.sh --install wordpress --with-needs"/);
  assert.match(row, /hx-post="\/actions\/plugins"/);
});

test('a settings file no plugin here owns is listed as such, with its own hint', () => {
  const loose = html.slice(html.indexOf('settings-loose'));
  assert.match(loose, /Other settings files/);
  assert.ok(loose.includes('href="/settings/workspace.handmade.settings.yml"'));
  assert.match(loose, /A folder made by hand/);
  assert.ok(!html.includes('href="/settings/workspace.dev.settings.yml"'), 'the folder of a plugin is on that plugin');
});

test('the filter is drawn hidden (a script shows it), is labelled, and announces what it shows', () => {
  assert.match(html, /<div class="settings-search" hidden>/);
  assert.match(html, /<label class="settings-search-label" for="settings-search-input">/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.strictEqual((html.match(/class="settings-chip"/g) || []).length, 4);
  assert.match(html, /data-show="all" aria-pressed="true"/);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /function settingsSearchApply/);
  assert.match(ui, /box\.hidden = false/);
});

test('a workspace with no plugin says so and leads to the catalogue', () => {
  const empty = home.homeHtml({ files: ['settings.yml'], plugins: [], groups: [], styles: { count: 1, wearing: 'Webship' } });
  assert.match(empty, /No plugins yet\./);
  assert.match(empty, /href="\/settings\/plugins">Choose from the catalogue</);
  assert.ok(!empty.includes('plugin-rows'));
});

test('the plugins are drawn again when a step has run, and the page says its files by the workspace path', () => {
  assert.match(html, /hx-get="\/fragments\/settings\/plugins" hx-trigger="refresh-projects from:body"/);
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /pathname === '\/fragments\/settings\/plugins'/);
  assert.ok(!server.includes(': fname(CONFIG_DIR);'), 'the heading does not print the home folder');
});

test('focus stays with the plugin when its row or its steps are drawn again after a step', () => {
  assert.match(html, /<li class="plugin-row" data-refocus="row-jira"/);
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'settings-plugin-page.js'), 'utf8');
  assert.match(page, /data-refocus="steps-\$\{esc\(p\.name\)\}"/);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /document\.activeElement !== document\.body\)\) return;/, 'only when focus was lost: a person who moved on is left where they are');
  assert.match(ui, /holder\.setAttribute\('tabindex', '-1'\)/);
});
