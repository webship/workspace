/**
 * The Settings modal, made calmer. Its overview said "7 need attention" as a button that presses a chip,
 * but the overview has no chips: pressing it did nothing. And with plugins added a third of its list of
 * tabs carried a grey pill ("Not active", "Update 1.0.11"), so twelve pills read as twelve things to do.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const model = require('../../settings-model.mts');
const home = require('../../settings-home');

const none = { unmet: [], problems: [] };
const plugin = (name, manifest, step) => ({ name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name, ...manifest }, step, wants: none });
const plugins = [plugin('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml' }, 2), plugin('lando', { label: 'Lando' }, 0), plugin('dev', { label: 'Dev', workspace: { key: 'dev' } }, 3)];
const groups = model.groupByFamily(plugins);

test('in the modal overview the number that waits is words; on the Settings page it stays the way to those plugins', () => {
  const overview = home.pluginsSectionHtml(groups, { only: 'attention' });
  assert.doesNotMatch(overview, /data-press-chip/, 'no button for a chip that is not there');
  assert.match(overview, /<span>1 needs attention<\/span>/);
  const page = home.pluginsSectionHtml(groups);
  assert.match(page, /<button type="button" class="settings-summary-link" data-press-chip="attention">1 needs attention<\/button>/);
});

test('the overview does not place the list "beside" it: on a phone the list is above', () => {
  const compact = home.homeHtml({ files: [], plugins, groups, styles: { count: 1, wearing: 'x' }, compact: true });
  assert.doesNotMatch(compact, /beside this/);
  assert.match(compact, /in this modal's list of tabs, and its filter narrows the list/);
});

test('a state that wants nothing is a word in the meta colour; only a state that asks for something is a pill', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'tab-modal.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const quiet = css.match(/\.tabmodal-badge:not\(\.is-warning\) \{([^}]*)\}/);
  assert.ok(quiet, 'no rule for the quiet badge');
  assert.match(quiet[1], /background: transparent/);
  assert.match(quiet[1], /color: var\(--text-subtle\)/);
  assert.match(css, /\.tabmodal-badge\.is-warning \{ background: var\(--warning-soft\); color: var\(--warning-ink\)/, 'the warning pill stays');
});

test('in the modal overview, where every row waits on something, the buttons are not filled; on the page they are', () => {
  const overview = home.pluginsSectionHtml(groups, { only: 'attention' });
  assert.doesNotMatch(overview, /uk-button-primary/, 'no filled button where every row is the same kind');
  assert.match(overview, /<a class="uk-button uk-button-default uk-button-small plugin-action" href="\/settings\/plugin\/jira#settings" aria-label="Configure Jira">Configure</);
  const page = home.pluginsSectionHtml(groups);
  assert.match(page, /<a class="uk-button uk-button-primary uk-button-small plugin-action" href="\/settings\/plugin\/jira#settings"/,
    'among ready rows, the one that waits is still the prominent one');
});
