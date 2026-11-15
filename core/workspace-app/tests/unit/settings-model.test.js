/**
 * The model behind Settings: which family a plugin is in, the one state it is in with the one
 * action that comes next, which files are its own, and a hint that is true for each file.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const model = require('../../settings-model');

const plugin = (name, manifest = {}, more = {}) => ({ name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name, ...manifest }, ...more });

test('a plugin is placed by what it says, then by what it is, then by the catalogue, then among the features', () => {
  assert.strictEqual(model.familyOf(plugin('anything', { family: 'hosting' })), 'hosting', 'the manifest wins');
  assert.strictEqual(model.familyOf(plugin('anything', { family: 'no-such-family' })), 'features', 'an unknown family is not invented');
  assert.strictEqual(model.familyOf(plugin('ai-agents', { workspace: { key: 'ai-agents' } })), 'ai', 'an ai-* folder is AI, not one of 26 folders');
  assert.strictEqual(model.familyOf(plugin('dev', { workspace: { key: 'dev' } })), 'folders');
  assert.strictEqual(model.familyOf(plugin('upsun')), 'hosting');
  assert.strictEqual(model.familyOf(plugin('github')), 'forges');
  assert.strictEqual(model.familyOf(plugin('lando')), 'containers');
  assert.strictEqual(model.familyOf(plugin('some-cms', { commands: { files: ['commands/cmd-some-cms-project.sh'] } })), 'platforms', 'it ships a builder and is not a folder');
  assert.strictEqual(model.familyOf(plugin('new-folder', { workspace: { key: 'things' } })), 'folders', 'a folder the catalogue does not list');
  assert.strictEqual(model.familyOf(plugin('never-heard-of')), 'features');
  assert.deepStrictEqual(model.FAMILIES.map((f) => f.id), ['platforms', 'folders', 'ai', 'hosting', 'forges', 'containers', 'features']);
});

test('the line under a plugin is its own summary, else the catalogue line, else the start of its description', () => {
  assert.strictEqual(model.summaryOf(plugin('x', { summary: 'Says  what it is ' })), 'Says what it is');
  assert.match(model.summaryOf(plugin('jira', { label: 'Jira' })), /Jira work items/);
  assert.strictEqual(model.summaryOf(plugin('never-heard-of', {}, { description: 'The thing that does one job well. And a second sentence nobody needs on a row.' })), 'The thing that does one job well');
  assert.strictEqual(model.summaryOf(plugin('never-heard-of')), '');
});

test('each step has one state and one next action', () => {
  const none = { unmet: [], problems: [] };
  const s0 = model.stateOf({ ...plugin('jira'), step: 0, wants: none });
  assert.deepStrictEqual([s0.id, s0.label, s0.attention, s0.active], ['not-active', 'Not active', false, false]);
  assert.deepStrictEqual(s0.action, { kind: 'post', verb: 'activate', label: 'Activate', withNeeds: false });

  const s1 = model.stateOf({ ...plugin('jira'), step: 1, wants: none });
  assert.deepStrictEqual([s1.id, s1.attention, s1.active, s1.action.verb, s1.action.label], ['not-installed', true, true, 'install', 'Install']);

  const s2 = model.stateOf({ ...plugin('jira'), step: 2, wants: none });
  assert.deepStrictEqual([s2.id, s2.label, s2.action.kind, s2.action.href], ['needs-settings', 'Needs settings', 'link', '/settings/plugin/jira#settings']);

  const s3 = model.stateOf({ ...plugin('jira'), step: 3, wants: none });
  assert.deepStrictEqual([s3.id, s3.label, s3.attention, s3.action.label], ['ready', 'Ready', false, 'Open']);
});

test('an unmet need turns the next step into "with what it needs", and names what is added', () => {
  const wants = { unmet: [{ anyOf: ['dev', 'test'], pick: 'dev' }, { anyOf: ['ai-agents'], pick: 'ai-agents' }], problems: [] };
  const s = model.stateOf({ ...plugin('wordpress'), step: 0, wants });
  assert.strictEqual(s.action.label, 'Activate with dev and ai-agents');
  assert.strictEqual(s.action.withNeeds, true);
  assert.match(s.note, /Needs dev and ai-agents/);
  const later = model.stateOf({ ...plugin('wordpress'), step: 3, wants });
  assert.deepStrictEqual([later.id, later.label, later.attention, later.action.withNeeds], ['needs', 'Needs dev and ai-agents', true, true]);
});

test('a need that cannot be met, files that are gone and a newer version are said, not hidden', () => {
  const cycle = model.stateOf({ ...plugin('a'), step: 0, wants: { unmet: [{ anyOf: ['b'], pick: 'b' }], problems: ['needs: a cycle (a → b → a)'] } });
  assert.deepStrictEqual([cycle.id, cycle.tone, cycle.action.kind], ['problem', 'danger', 'link']);
  const gone = model.stateOf({ ...plugin('a'), step: 3, wants: { unmet: [], problems: [] }, placed: { missing: ['dev/cmd-a.sh'] } });
  assert.deepStrictEqual([gone.id, gone.action.label, gone.note], ['files-missing', 'Reinstall', '1 placed file is gone']);
  const isNewer = (a, b) => a === '1.0.1' && b === '1.0.0';
  const old = model.stateOf({ ...plugin('a'), step: 3, wants: { unmet: [], problems: [] } }, { latest: '1.0.1', isNewer });
  assert.deepStrictEqual([old.id, old.update, old.attention], ['ready', '1.0.1', false], 'a newer version is not a blocker');
  const same = model.stateOf({ ...plugin('a'), step: 3, wants: { unmet: [], problems: [] } }, { latest: '1.0.0', isNewer });
  assert.deepStrictEqual([same.update, same.attention], ['', false]);
});

test('plugins are grouped by family in the family order, by label inside one, and an empty family is not drawn', () => {
  const none = { unmet: [], problems: [] };
  const rows = [
    { ...plugin('upsun', { label: 'Upsun' }), step: 3, wants: none },
    { ...plugin('wordpress', { label: 'WordPress', commands: { files: ['commands/cmd-wordpress-project.sh'] } }), step: 1, wants: none },
    { ...plugin('drupal', { label: 'Drupal' }), step: 0, wants: none },
    { ...plugin('ai-skills', { label: 'AI Skills', workspace: { key: 'ai-skills' } }), step: 3, wants: none },
  ];
  const groups = model.groupByFamily(rows);
  assert.deepStrictEqual(groups.map((g) => g.id), ['platforms', 'ai', 'hosting']);
  assert.deepStrictEqual(groups[0].plugins.map((p) => p.name), ['drupal', 'wordpress']);
  assert.deepStrictEqual(model.counts(groups), { all: 4, attention: 1, active: 3, inactive: 1, ready: 2, updates: 0 });
});

test('a settings file belongs to the base, the styles, a plugin, a folder no plugin made, or is said to be unknown', () => {
  const plugins = [plugin('jira', { settingsFile: 'plugin.jira.settings.yml' }), plugin('avatar', { settingsFile: 'plugin.avatar.settings.yml', workspace: { key: 'avatars' } })];
  assert.deepStrictEqual(model.filesOf(plugins[1]), [{ file: 'plugin.avatar.settings.yml', kind: 'plugin' }, { file: 'workspace.avatars.settings.yml', kind: 'folder' }]);
  const sorted = model.sortFiles(['settings.yml', 'style.yml', 'theme.slate.yml', 'theme.default.yml', 'plugin.jira.settings.yml',
    'workspace.avatars.settings.yml', 'workspace.old.settings.yml', 'plugin.gone.settings.yml'], plugins);
  assert.deepStrictEqual(sorted.general, ['settings.yml']);
  assert.deepStrictEqual(sorted.styles, ['style.yml', 'theme.slate.yml', 'theme.default.yml'], 'the themes are one entry, not nine settings files');
  assert.deepStrictEqual(sorted.folders, ['workspace.old.settings.yml']);
  assert.deepStrictEqual(sorted.other, ['plugin.gone.settings.yml']);
  assert.deepStrictEqual(sorted.owned.get('workspace.avatars.settings.yml'), { plugin: 'avatar', kind: 'folder' });
});

test('every file has a hint of its own: the sentence about paths and API keys is not said of a theme', () => {
  const hints = ['settings.yml', 'style.yml', 'theme.slate.yml', 'plugin.jira.settings.yml', 'workspace.dev.settings.yml'].map((f) => model.fileHint(f));
  assert.strictEqual(new Set(hints).size, hints.length, 'no two files share a hint');
  assert.match(model.fileHint('theme.slate.yml'), /slate style/);
  assert.doesNotMatch(model.fileHint('theme.slate.yml'), /API keys/);
  assert.match(model.fileHint('plugin.jira.settings.yml', { pluginLabel: 'Jira' }), /Settings of the Jira plugin/);
  assert.strictEqual(model.fileHint('workspace.dev.settings.yml', { folderSubtitle: 'Development Projects' }), 'Development Projects');
});

test('a description that only repeats the name is not a summary', () => {
  assert.strictEqual(model.summaryOf(plugin('some-cms', { label: 'Some CMS' }, { description: 'Some CMS for Webship Workspace: builders and tools.' })), '');
  assert.strictEqual(model.summaryOf(plugin('some-cms', { label: 'Some CMS' }, { description: 'Builders for Some CMS sites for Webship Workspace.' })), 'Builders for Some CMS sites');
});
