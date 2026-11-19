/**
 * A plugin's own page: the four steps as one list with the next one carrying the action, needs met
 * or not with the fix, its settings, what it ships, and a removal that is refused in words.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const model = require('../../settings-model');
const page = require('../../settings-plugin-page');

const none = { needs: [], suggests: [], unmet: [], problems: [] };
const make = (name, manifest, step, more = {}) => {
  const row = { name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name, ...manifest }, step, wants: none, placed: {}, ...more };
  return model.groupByFamily([row])[0].plugins[0];
};

test('the four steps are one list: done, the one that is next with its button and its command, the rest later', () => {
  const p = make('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml', settingsTemplate: 'config/x.yml' }, 1);
  const list = page.steps(p);
  assert.deepStrictEqual(list.map((s) => `${s.id}:${s.status}`), ['require:done', 'activate:done', 'install:now', 'configure:later']);
  assert.deepStrictEqual(list.filter((s) => s.action).map((s) => s.id), ['install'], 'one action, on the step that is next');
  const html = page.stepsHtml(p);
  assert.strictEqual((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /<ol class="plugin-step-list">/);
  assert.match(html, /bash core\/scripts\/plugins\.sh --install jira</, 'the same step for a terminal');
  for (const word of ['Done', 'Next', 'Later']) assert.ok(html.includes(`>${word}</span>`), `${word} is said in words`);
});

test('a need that is not met is resolved by the step itself: the button names what is added and runs --with-needs', () => {
  const wants = { needs: [{ anyOf: ['specs'], metBy: null, pick: 'specs' }, { anyOf: ['products', 'projects'], metBy: 'projects', pick: 'projects' }],
    suggests: [{ anyOf: ['github'], metBy: null, pick: 'github' }], unmet: [{ anyOf: ['specs'], metBy: null, pick: 'specs' }], problems: [] };
  const p = make('notes', { label: 'Notes' }, 0, { wants });
  const activate = page.steps(p)[1];
  assert.deepStrictEqual(activate.action, { verb: 'activate', label: 'Activate with specs', withNeeds: true });
  assert.match(activate.text, /It needs specs, which is not here yet: one run adds it first/);
  const html = page.stepsHtml(p);
  assert.match(html, /&quot;withNeeds&quot;:&quot;1&quot;/);
  assert.match(html, /--activate notes --with-needs/);
  const needs = page.needsHtml(p, new Set(['specs', 'projects']));
  assert.match(needs, /<strong>specs<\/strong>: not here\./);
  assert.match(needs, /<em>Activate with specs<\/em> adds it in the same run, or open <a href="\/settings\/plugin\/specs">specs<\/a>/);
  assert.match(needs, /<strong>products or projects<\/strong>: met by <a href="\/settings\/plugin\/projects">projects<\/a>/);
  assert.match(needs, /github: not here, and not needed/, 'a suggestion is said, never added');
});

test('a plugin with nothing to place or to configure says so, and is not left waiting on a step', () => {
  const p = make('notes', { label: 'Notes' }, 3);
  const list = page.steps(p);
  assert.deepStrictEqual(list.map((s) => s.status), ['done', 'done', 'done', 'done']);
  assert.match(list[2].text, /Nothing to place/);
  assert.match(list[3].text, /No settings file/);
  assert.match(page.needsHtml(p), /Needs nothing from another plugin/);
  assert.match(page.settingsHtml(p, { files: [] }), /This plugin has no settings\./);
  assert.match(page.shipsHtml(p, {}), /ships no files for the workspace/);
});

test('the settings are the form of its file, a way to the folder file, or the reason there is none yet', () => {
  const p = make('avatar', { label: 'Avatar', settingsFile: 'plugin.avatar.settings.yml', workspace: { key: 'avatars' } }, 3);
  const files = [{ file: 'plugin.avatar.settings.yml', kind: 'plugin', exists: true }, { file: 'workspace.avatars.settings.yml', kind: 'folder', exists: true }];
  const both = page.settingsHtml(p, { files, chosen: files[1], formHtml: '<form id="the-form"></form>' });
  assert.match(both, /href="\/settings\/plugin\/avatar\?file=plugin#settings">Plugin settings</);
  assert.match(both, /href="\/settings\/plugin\/avatar\?file=folder#settings" aria-current="page">Folder settings</);
  assert.match(both, /<form id="the-form">/);
  const early = make('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml' }, 1);
  assert.match(page.settingsHtml(early, { files: [{ file: 'plugin.jira.settings.yml', kind: 'plugin', exists: false }] }), /core\/config\/plugin\.jira\.settings\.yml<\/code> is written by Install, the step above/);
});

test('what it ships: commands with the folders they were placed in, AI items by kind, and a kind with no folder is said', () => {
  const p = make('upsun', { label: 'Upsun', commands: { files: ['commands/cmd-tools-upsun.sh'] }, ai: { agents: ['ai/agents/upsun-deployer.md'], prompts: ['ai/prompts/upsun-test.md'] }, themes: ['config/theme.upsun.yml'] }, 3);
  const html = page.shipsHtml(p, { record: { installed: '2026-11-15T09:00:00Z', placed: ['dev/cmd-tools-upsun.sh', 'test/cmd-tools-upsun.sh', 'ai-agents/upsun-deployer.md'] }, workspaces: new Set(['dev', 'test', 'ai-agents']) });
  assert.match(html, /<code>cmd-tools-upsun\.sh<\/code><span class="plugin-quiet">in <code>dev\/<\/code>, <code>test\/<\/code>/);
  assert.match(html, /<code>upsun-deployer<\/code><\/span>\s*<span class="plugin-quiet">in <a href="\/ai-agents">ai-agents\/<\/a>/);
  assert.match(html, /skipped: there is no ai-prompts\/ folder here/);
  assert.match(html, /Also: 1 style\./);
  assert.match(html, /<summary>3 files placed on 2026-11-15<\/summary>/);
});

test('removing a plugin another one needs is refused in words, with no button to try; Reinstall stays, so an update can be finished (#410)', () => {
  const needed = make('ai-agents', { label: 'AI Agents', workspace: { key: 'ai-agents' } }, 3, { neededBy: ['dev', 'jira'], placed: { installed: true } });
  const refused = page.removeHtml(needed);
  assert.match(refused, /cannot be deactivated or uninstalled while dev, jira need it/);
  assert.ok(refused.includes('&quot;verb&quot;:&quot;install&quot;'), 'Reinstall is there');
  assert.match(refused, />Reinstall</);
  for (const verb of ['deactivate', 'uninstall']) assert.ok(!refused.includes(`&quot;verb&quot;:&quot;${verb}&quot;`), `no ${verb}`);
  // The update notice sends the person here: the button it names is on the page.
  const updated = make('ai-agents', { label: 'AI Agents', workspace: { key: 'ai-agents' } }, 3, { neededBy: ['dev'], placed: { installed: true } });
  updated.state = { ...(updated.state || {}), update: '9.9.9' };
  updated.module = '@webship.co/workspace-ai-agents';
  assert.match(page.updateHtml(updated), /Then Reinstall, at the end of this page/);
  assert.match(page.removeHtml(updated), />Reinstall</);
  // A plugin that places nothing has nothing to reinstall.
  assert.ok(!page.removeHtml(make('x-api', { label: 'X API' }, 3, { neededBy: ['dev'] })).includes('<button'));
  const free = make('jira', { label: 'Jira', settingsTemplate: 'config/x.yml' }, 3, { placed: { installed: true } });
  const html = page.removeHtml(free);
  for (const verb of ['install', 'deactivate', 'uninstall']) assert.ok(html.includes(`&quot;verb&quot;:&quot;${verb}&quot;`), verb);
  assert.match(html, /hx-confirm="Uninstall Jira\?/, 'the question names the action and the plugin');
});

test('a plugin that is not active and placed nothing offers Remove; one another plugin needs does not (#493)', () => {
  const html = page.removeHtml(make('jira', { label: 'Jira' }, 0));
  assert.ok(html.includes('&quot;verb&quot;:&quot;remove&quot;'), 'Remove runs plugins.sh --remove');
  assert.match(html, /hx-confirm="Remove Jira\?/, 'the question names the action and the plugin');
  assert.match(html, /plugin-buttons-apart/, 'drawn apart, as Uninstall is');
  assert.ok(!page.removeHtml(make('dev', { label: 'Dev' }, 0, { neededBy: ['wp'] })).includes('<button'), 'none while another plugin needs it');
});

test('the state part is drawn again when a step has run; the form beside it is not; an unknown plugin is a 404 that says where to add it', () => {
  const p = make('jira', { label: 'Jira' }, 0);
  const html = page.pluginPageHtml(p, { files: [], known: new Set() });
  assert.match(html, /id="plugin-status" hx-get="\/fragments\/settings\/plugin\/jira\?part=status" hx-trigger="refresh-projects from:body" hx-swap="outerHTML"/);
  const status = html.slice(html.indexOf('id="plugin-status"'), html.indexOf('id="settings"'));
  assert.ok(status.includes('plugin-step-list') && !status.includes('id="needs"'), 'the state and the steps; the needs follow the settings');
  assert.ok(html.indexOf('id="settings"') < html.indexOf('id="needs"'), 'the settings come before what it needs');
  for (const id of ['needs', 'settings', 'ships', 'remove']) assert.ok(html.includes(`id="${id}"`), `#${id}`);
  assert.match(page.missingHtml('nope'), /No plugin called nope is added to this workspace/);
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /res\.writeHead\(data \? 200 : 404/);
  assert.match(server, /part of'\} the <a href="\/settings\/plugin\//, 'a settings file that is a plugin own leads to its page');
});

test('a plugin that is active but not loaded says so, with the command that loads it', () => {
  const html = page.statusHtml(make('jira', { label: 'Jira' }, 3, { loaded: false }));
  assert.match(html, /Active, but not loaded yet\./);
  assert.match(html, /plugins\.sh --restart/);
  assert.ok(!page.statusHtml(make('jira', { label: 'Jira' }, 3, { loaded: true })).includes('not loaded yet'));
  assert.ok(!page.statusHtml(make('jira', { label: 'Jira' }, 0, { loaded: false })).includes('not loaded yet'), 'a plugin that is not active is not expected to be loaded');
});

test('saving the form on a plugin page draws its state again: "Needs settings" does not outlive the save', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /if \(ok && form\.closest\('\.plugin-page'\)\) document\.body\.dispatchEvent\(new CustomEvent\('refresh-projects'\)\);/);
  const html = page.pluginPageHtml(make('jira', { label: 'Jira' }, 2), { files: [], known: new Set() });
  assert.ok(html.indexOf('id="plugin-status"') < html.indexOf('id="settings"'), 'the state is outside the form, so the form is not redrawn under the person');
});

test('what it ships and the removal follow a step; the settings section follows one only while it has no form', () => {
  const p = make('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml', settingsTemplate: 'config/x.yml' }, 1);
  const files = [{ file: 'plugin.jira.settings.yml', kind: 'plugin', exists: false }];
  const early = page.pluginPageHtml(p, { files, known: new Set() });
  assert.match(early, /id="plugin-after" hx-get="\/fragments\/settings\/plugin\/jira\?part=after" hx-trigger="refresh-projects from:body" hx-swap="outerHTML"/);
  assert.match(early, /id="settings" aria-labelledby="plugin-settings-head"\s+hx-get="\/fragments\/settings\/plugin\/jira\?part=settings" hx-trigger="refresh-projects from:body"/, 'no form yet: it is asked for when Install has run');
  const withForm = page.settingsSectionHtml(p, { files: [{ ...files[0], exists: true }], chosen: { ...files[0], exists: true }, formHtml: '<form id="f"></form>' });
  assert.ok(!withForm.includes('hx-get='), 'a form that is there is never replaced under the person typing in it');
  assert.match(withForm, /<form id="f">/);
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /part === 'after' \? pluginPage\.afterHtml\(data\.plugin, data\)/);
  assert.match(server, /settingsPluginData\(ps\[1\], '', \{ form: part === 'settings' \}\)/);
});

test('only the steps that are real for a plugin are numbered and counted', () => {
  const p = make('notes', { label: 'Notes' }, 0);
  assert.strictEqual(page.stepsLeft(p), 1);
  const html = page.stepsHtml(p);
  assert.match(html, /Turn it on: one step left/);
  assert.strictEqual((html.match(/class="plugin-step-item /g) || []).length, 2, 'Require and Activate; Install and Configure do not apply');
  assert.match(html, /plugin-steps-skipped">Nothing to place: this plugin ships no files for the workspace\. No settings file: nothing to configure\./);
  const full = make('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml', settingsTemplate: 'config/x.yml' }, 0);
  assert.match(page.stepsHtml(full), /Turn it on: three steps left/);
});

test('a plugin that is turned on shows one line, with the steps behind it', () => {
  const html = page.stepsHtml(make('jira', { label: 'Jira', settingsFile: 'plugin.jira.settings.yml', settingsTemplate: 'config/x.yml' }, 3));
  assert.match(html, /^<details class="plugin-steps-done"><summary>/);
  assert.match(html, /Turned on<\/span>\s*<span class="plugin-quiet">required, activated, installed, configured<\/span>/);
  assert.ok(!html.includes('Turn it on:'));
  assert.match(page.stepsHtml(make('notes', { label: 'Notes' }, 3)), /<span class="plugin-quiet">required, activated<\/span>/);
});

test('a need that is here says so once, a web address in a hint is a link, backticks are not printed', () => {
  const wants = { needs: [{ anyOf: ['ai-agents'], metBy: 'ai-agents', pick: 'ai-agents' }, { anyOf: ['dev', 'test'], metBy: 'dev', pick: 'dev' }],
    suggests: [{ anyOf: ['github'], metBy: 'github', pick: 'github' }], unmet: [], problems: [] };
  const p = make('upsun', { label: 'Upsun' }, 3, { wants, description: 'One builder (`cmd-x.sh`) and more.',
    commands: [{ anyOf: ['upsun'], where: 'host', state: 'missing', kind: 'needs', hint: 'see https://docs.example.com/cli.html' }] });
  const needs = page.needsHtml(p, new Set(['ai-agents', 'dev', 'github']));
  assert.match(needs, /<strong><a href="\/settings\/plugin\/ai-agents">ai-agents<\/a><\/strong>: here\./);
  assert.ok(!needs.includes('met by <a href="/settings/plugin/ai-agents">'));
  assert.match(needs, /<strong>dev or test<\/strong>: met by <a href="\/settings\/plugin\/dev">dev<\/a>\./);
  assert.match(needs, /<a href="\/settings\/plugin\/github">github<\/a>: here\./);
  assert.match(needs, /Install: see <a href="https:\/\/docs\.example\.com\/cli\.html" rel="noopener">/);
  assert.ok(!page.statusHtml(p).includes('`'));
});

test('Uninstall is drawn as the one that removes files, last and apart; each button can take focus back by its own name', () => {
  const html = page.removeHtml(make('jira', { label: 'Jira', settingsTemplate: 'config/x.yml' }, 3, { placed: { installed: true } }));
  assert.ok(html.indexOf('>Uninstall<') > html.indexOf('>Deactivate<'));
  assert.match(html, /<span class="plugin-buttons-apart"><button type="button" class="uk-button uk-button-danger plugin-danger uk-button-small" data-refocus-item="uninstall"/);
  for (const verb of ['install', 'deactivate', 'uninstall']) assert.ok(html.includes(`data-refocus-item="${verb}"`), verb);
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
  assert.match(ui, /el\.dataset\.refocusItem === settingsFocusItem/);
});

test('in a pane of the settings modal the plugin name is the pane heading, not said again', () => {
  const p = make('jira', { label: 'Jira' }, 3);
  assert.ok(!page.statusHtml(p, { fragment: true }).includes('plugin-head-name'));
  assert.match(page.statusHtml(p), /<h2 class="plugin-head-name">Jira<\/h2>/);
});

test('a settings field: the label is its name only, hints are tied with aria-describedby, a placeholder value is marked', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /const keyHtml = \(r, id, name, secret = false\) => `<div class="settings-key"><label for="\$\{id\}">\$\{esc\(name\)\}<\/label>/);
  assert.ok(!/<label class="settings-key" for="\$\{id\}">[^\n]*fieldHint/.test(server), 'no hint inside a label');
  assert.match(server, /const isTodo = \(r\) => !r\.list && \/CHANGE_ME\/\.test\(String\(r\.value \|\| ''\)\);/);
  assert.match(server, /Still the placeholder: replace it/);
  assert.match(server, /aria-describedby="\$\{ids\.join\(' '\)\}"/);
  assert.match(server, /still hold'\} the placeholder/);
  assert.match(server, /settingsFormHtml\(chosen\.file, '', \{ heading: 'h4' \}\)/, 'under the h3 "Settings" of a plugin page the file name is an h4');
});

test('each page says what it is in its title', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /const titled = isPlugin \? `\$\{options\.pluginName\} · Plugins · Settings`/);
  assert.match(server, /: isPlugins \? 'Add a plugin · Settings'/);
});
