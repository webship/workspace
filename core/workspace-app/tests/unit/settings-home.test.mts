/**
 * Settings home: the base as a few entries, the plugins as rows by family with a state in words and
 * one action, a filter that is hidden until a script shows it, and honest empty states.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import * as model from '../../settings-model.mts';
import type { PluginRow } from '../../settings-model.mts';
import * as home from '../../settings-home.mts';

const none = { unmet: [], problems: [] };
const plugin = (name: string, manifest: Record<string, unknown>, step: number, more: Record<string, unknown> = {}): PluginRow => ({ name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name, ...manifest }, step, wants: none, ...more });
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

test('every plugin is a row in its family: a link to its page, the line that says what it is, one state pill, one action', () => {
  assert.strictEqual((html.match(/<li class="plugin-row" /g) || []).length, 4);
  for (const f of ['platforms', 'folders', 'containers', 'features']) assert.ok(html.includes(`data-family="${f}"`), f);
  assert.ok(!html.includes('data-family="hosting"'), 'a family with no plugin is not drawn');
  assert.ok(html.includes('href="/settings/plugin/jira"'));
  for (const label of ['Needs settings', 'Not installed', 'Ready', 'Not active']) assert.ok(html.includes(`<span>${label}</span>`), label);
  assert.strictEqual((html.match(/class="plugin-state /g) || []).length, 4, 'one pill a row');
  assert.match(html, /<span class="settings-group-summary"><span>4 added<\/span> · <span>1 ready<\/span> · <button type="button" class="settings-summary-link" data-press-chip="attention">2 need attention<\/button> · <span>1 not active<\/span><\/span>/,
    'the number that says something is waiting is the way to it');
  // The second line is what the plugin is, never the reason for its state and never a package name.
  assert.match(html, /<span class="plugin-row-summary">Jira work items, through the Teamwork Graph CLI<\/span>/);
  assert.ok(!/plugin-row-summary">@webship/.test(html));
  assert.match(html, /class="plugin-state is-warning" title="Its settings are not filled in yet"/, 'the reason is on the pill');
});

test('only a row with work to do carries a button: Configure is as prominent as Install, a ready row ends in a chevron', () => {
  assert.match(html, /<a class="uk-button uk-button-primary uk-button-small plugin-action" href="\/settings\/plugin\/jira#settings" aria-label="Configure Jira">Configure</);
  const ready = html.slice(html.indexOf('data-state="ready"'));
  const row = ready.slice(0, ready.indexOf('</li>'));
  assert.match(row, /<span class="plugin-row-chevron" aria-hidden="true">/);
  assert.strictEqual((row.match(/<a /g) || []).length, 1, 'one link to the plugin page, not two');
});

test('a step with an unmet need: a short word on the button, the whole sentence in its name, --with-needs, the command in its title', () => {
  const row = html.slice(html.indexOf('data-state="not-installed"'));
  assert.match(row, /aria-label="Install with dev: WordPress">Install</);
  assert.match(row, /<span class="plugin-row-extra">needs dev<\/span>/);
  assert.match(row, /&quot;withNeeds&quot;:&quot;1&quot;/);
  assert.match(row, /title="bash core\/scripts\/plugins\.sh --install wordpress --with-needs"/);
  assert.match(row, /hx-post="\/actions\/plugins"/);
});

test('a newer version is quiet text beside the name and a chip of its own: it is never a second pill and never counted as attention', () => {
  const rows = [plugin('git', { label: 'Git' }, 3)];
  const g = model.groupByFamily(rows, { latest: { '@webship.co/workspace-git': '1.0.9' }, isNewer: (a, b) => a !== b });
  const page = home.homeHtml({ files: ['settings.yml'], plugins: rows, groups: g, styles: { count: 1, wearing: 'x' } });
  assert.match(page, /<span class="plugin-row-extra">1\.0\.0 → 1\.0\.9<\/span>/);
  assert.strictEqual((page.match(/class="plugin-state /g) || []).length, 1);
  assert.match(page, /data-show="updates" aria-pressed="false">Updates <span class="settings-chip-count" data-count="updates">1</);
  assert.match(page, /data-count-attention="0"[^>]*data-count-updates="1"/);
  assert.match(page, /data-update="1"/);
  // Not known yet (the registry has not answered): the chip is there, hidden, and no other count waits for it.
  assert.match(html, /data-show="updates" aria-pressed="false" hidden>/);
});

test('a plugin with nothing that says what it is gets a name with capitals and "No description", not a raw id', () => {
  const rows = [plugin('workspace-notes', {}, 0)];
  const page = home.homeHtml({ files: [], plugins: rows, groups: model.groupByFamily(rows), styles: { count: 1, wearing: 'x' } });
  assert.match(page, /<span class="plugin-row-name">Workspace Notes<\/span>/);
  assert.match(page, /<span class="plugin-row-summary">No description<\/span>/);
});

test('in the settings modal the home is an overview: what needs attention, not the list and the filter a second time', () => {
  const compact = home.homeHtml({ files, plugins, groups: model.groupByFamily(plugins), styles: { count: 2, wearing: 'x' }, compact: true });
  assert.ok(!compact.includes('settings-search-input') && !compact.includes('settings-base'));
  assert.strictEqual((compact.match(/<li class="plugin-row" /g) || []).length, 2, 'the two that need something');
  assert.match(compact, /Plugins that need attention/);
  assert.match(compact, /hx-get="\/fragments\/settings\/plugins\?only=attention"/);
  const calm = home.pluginsSectionHtml(model.groupByFamily([plugin('dev', { label: 'Dev', workspace: { key: 'dev' } }, 3)]), { only: 'attention' });
  assert.match(calm, /Nothing needs attention/);
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
  assert.strictEqual((html.match(/class="settings-chip"/g) || []).length, 5);
  assert.match(html, /data-show="all" aria-pressed="true"/);
  const ui = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'ui.js'), 'utf8');
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
  const server = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /pathname === '\/fragments\/settings\/plugins'/);
  assert.ok(!server.includes(': fname(CONFIG_DIR);'), 'the heading does not print the home folder');
});

test('focus stays with the plugin when its row or its steps are drawn again after a step', () => {
  assert.match(html, /<li class="plugin-row" data-refocus="row-jira"/);
  const page = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'settings-plugin-page.js'), 'utf8');
  assert.match(page, /data-refocus="steps-\$\{esc\(p\.name\)\}"/);
  const ui = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /document\.activeElement !== document\.body\)\) return;/, 'only when focus was lost: a person who moved on is left where they are');
  assert.match(ui, /clearTimeout\(settingsRefocusTimer\);/, 'after the last of the redraws, not the first');
  assert.match(ui, /holder\.setAttribute\('tabindex', '-1'\)/);
});
