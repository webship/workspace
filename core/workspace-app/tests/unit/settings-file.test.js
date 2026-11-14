/**
 * The settings writers, against a real file in a temporary config directory.
 *
 * The contract they all share: an edit replaces the LINES it means to change and leaves the rest
 * of the file byte-for-byte. These files are hand-maintained and heavily commented, so a writer
 * that reflows one is worse than one that refuses.
 *
 * WORKSPACE_CONFIG is read when workspaces.js loads, so it is set before the require below —
 * these tests never touch the real core/config.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-settings-'));
process.env.WORKSPACE_CONFIG = TMP;

const { writeWorkspacePresentation, readListBlock, writeListBlock, writeSettingsValues,
  readSettingsRows, isSecretKey, listSettingsFiles } = require('../../settings-file');

const write = (name, text) => { fs.writeFileSync(path.join(TMP, name), text); return name; };
const read = (name) => fs.readFileSync(path.join(TMP, name), 'utf8');

// The RAG workspace, as it actually is on disk: an icon and a subtitle the form knows about, and
// four keys plus a comment that it does not.
const RAG = `doc:
  name: rag

presentation:
  icon: tabler:database-search
  # The folder is \`rag\`; the dashboard card says RAG, because that is what it is called —
  # \`label\` is the presentational name and never the directory.
  label: RAG
  subtitle: Milvus Vector Databases & Project RAG Indexes
  noun: instance
  kind: projects
  also_files: true
`;

test('changing the icon keeps every other key in the block', () => {
  const f = write('workspace.rag.settings.yml', RAG);
  writeWorkspacePresentation(f, 'tabler:database', 'Milvus Vector Databases & Project RAG Indexes');
  const out = read(f);
  // The one thing that was asked for:
  assert.match(out, /^ {2}icon: tabler:database$/m);
  // And everything that was not:
  for (const kept of ['label: RAG', 'noun: instance', 'kind: projects', 'also_files: true']) {
    assert.ok(out.includes(kept), `${kept} was deleted`);
  }
  assert.ok(out.includes('`label` is the presentational name'), 'the comment was deleted');
});

test('changing the subtitle rewrites one line and nothing else', () => {
  const f = write('workspace.rag.settings.yml', RAG);
  writeWorkspacePresentation(f, 'tabler:database-search', 'Vector databases');
  const out = read(f);
  assert.match(out, /^ {2}subtitle: "Vector databases"$/m);
  assert.equal(out.split('\n').length, RAG.split('\n').length, 'the file changed length');
  assert.ok(out.includes('also_files: true'));
});

test('an empty value removes that line only', () => {
  const f = write('workspace.rag.settings.yml', RAG);
  writeWorkspacePresentation(f, 'tabler:database-search', '');
  const out = read(f);
  assert.ok(!/^ {2}subtitle:/m.test(out), 'the subtitle should be gone');
  assert.ok(out.includes('label: RAG'), 'and nothing else with it');
});

test('a file with no presentation block gets one', () => {
  const f = write('workspace.dev.settings.yml', 'doc:\n  name: dev\n');
  writeWorkspacePresentation(f, 'tabler:code', 'Development Projects');
  const out = read(f);
  assert.match(out, /^presentation:$/m);
  assert.match(out, /^ {2}icon: tabler:code$/m);
  assert.match(out, /^ {2}subtitle: "Development Projects"$/m);
});

test('clearing the only two keys drops the block, since an empty one parses as null', () => {
  const f = write('workspace.dev.settings.yml', 'doc:\n  name: dev\npresentation:\n  icon: tabler:code\n  subtitle: Dev\n');
  writeWorkspacePresentation(f, '', '');
  assert.ok(!/presentation:/.test(read(f)), 'the empty block should be gone');
});

test('a list block round-trips without disturbing the file around it', () => {
  const f = write('settings.yml', '# top\nworkspaces:\n  - dev\n  - test\n\nstyle:\n  theme: default\n');
  assert.deepEqual(readListBlock(f, 'workspaces').items, ['dev', 'test']);
  writeListBlock(f, 'workspaces', ['test', 'dev', 'rag']);
  const out = read(f);
  assert.deepEqual(readListBlock(f, 'workspaces').items, ['test', 'dev', 'rag']);
  assert.ok(out.startsWith('# top\n'), 'the comment above it survived');
  assert.ok(out.includes('style:\n  theme: default'), 'the block below it survived');
});

test('a value is written on its own line, with its comment kept', () => {
  const f = write('settings.yml', 'style:\n  theme: default   # which palette\n  page_size: 50\n');
  const rows = readSettingsRows(f);
  const theme = rows.find((r) => r.dotted === 'style.theme');
  writeSettingsValues(f, [{ line: theme.line, key: 'theme', value: 'ember' }]);
  const out = read(f);
  assert.match(out, /^ {2}theme: ember {3}# which palette$/m);
  assert.ok(out.includes('page_size: 50'));
});

test('a value that would change type is quoted', () => {
  const f = write('settings.yml', 'a:\n  b: x\n');
  const rows = readSettingsRows(f);
  writeSettingsValues(f, [{ line: rows[0].line, key: 'b', value: 'no' }]);
  assert.match(read(f), /^ {2}b: "no"$/m);
});

test('account.pass is not a secret, because it is the admin password you log in with', () => {
  assert.equal(isSecretKey('pass', 'account.pass'), false);
  assert.equal(isSecretKey('pass', 'git.github.pass'), true);
  assert.equal(isSecretKey('api_key', 'ai.api_key'), true);
  assert.equal(isSecretKey('name', 'account.name'), false);
});

test('settings.yml is listed first, then the workspace files', () => {
  write('settings.yml', 'a: 1\n');
  write('workspace.zz.settings.yml', 'a: 1\n');
  write('workspace.aa.settings.yml', 'a: 1\n');
  write('not-a-settings-file.txt', 'x');
  const files = listSettingsFiles();
  assert.equal(files[0], 'settings.yml');
  assert.ok(files.includes('workspace.aa.settings.yml'));
  assert.ok(!files.includes('not-a-settings-file.txt'));
  assert.ok(files.indexOf('workspace.aa.settings.yml') < files.indexOf('workspace.zz.settings.yml'));
});

test('upsertSettingsValue rewrites a key in place and creates what a file lacks, under its parent', () => {
  const { upsertSettingsValue } = require('../../settings-file');
  const file = path.join(TMP, 'settings.yml');
  fs.writeFileSync(file, 'a: 1\n\ngoogle_drive:\n  client_id: x  # keep me\n  destinations:\n    docs: ""\n\nz: 2\n');

  upsertSettingsValue('settings.yml', 'google_drive.client_id', 'yy');
  assert.match(fs.readFileSync(file, 'utf8'), /client_id: yy  # keep me/);
  upsertSettingsValue('settings.yml', 'google_drive.destinations.videos', 'abc');          // a key beside an existing one
  upsertSettingsValue('settings.yml', 'google_drive.root_folder', '1AbC_d-9');             // a key under an existing block
  upsertSettingsValue('settings.yml', 'google_drive.sources.test', 'test-reports');        // a new map under it
  upsertSettingsValue('settings.yml', 'brand_new.key', 'v');                               // a new top-level block
  const text = fs.readFileSync(file, 'utf8');
  const rows = Object.fromEntries(readSettingsRows('settings.yml').map((r) => [r.dotted, r.value]));
  assert.strictEqual(rows['google_drive.destinations.videos'], 'abc');
  assert.strictEqual(rows['google_drive.destinations.docs'], '""');
  assert.strictEqual(rows['google_drive.root_folder'], '1AbC_d-9');
  assert.strictEqual(rows['google_drive.sources.test'], 'test-reports');
  assert.strictEqual(rows['brand_new.key'], 'v');
  assert.strictEqual(rows.z, '2', 'what follows is untouched');
  assert.ok(text.indexOf('google_drive.') < 0 && text.indexOf('brand_new:') > text.indexOf('z: 2'), 'a new top-level block goes at the end');
  assert.ok(require('js-yaml').load(text).google_drive.sources.test === 'test-reports', 'and it still parses');
});

test('upsertSettingsValue opens an empty flow map instead of writing the key a second time', () => {
  const { upsertSettingsValue, upsertSettingsList } = require('../../settings-file');
  const yaml = require('js-yaml');
  const file = path.join(TMP, 'settings.yml');
  // The lean template a new workspace starts from: no workspaces, no plugins.
  fs.writeFileSync(file, fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'settings.template.yml'), 'utf8'));
  assert.match(fs.readFileSync(file, 'utf8'), /^plugins: \{\}$/m, 'the template ships plugins as an empty map');
  // What `plugins.sh --activate` writes for two plugins, one after the other.
  for (const name of ['dev', 'wordpress']) {
    upsertSettingsValue('settings.yml', `plugins.${name}.enabled`, true);
    upsertSettingsValue('settings.yml', `plugins.${name}.module`, `@webship.co/workspace-${name}`);
    upsertSettingsList('settings.yml', 'workspaces', [...(yaml.load(fs.readFileSync(file, 'utf8')).workspaces || []), name]);
  }
  const text = fs.readFileSync(file, 'utf8');
  assert.strictEqual((text.match(/^plugins:/gm) || []).length, 1, 'one plugins block');
  const settings = yaml.load(text);
  assert.deepStrictEqual(Object.keys(settings.plugins).sort(), ['dev', 'wordpress']);
  assert.strictEqual(settings.plugins.wordpress.enabled, true);
  assert.strictEqual(settings.plugins.dev.module, '@webship.co/workspace-dev');
  assert.deepStrictEqual(settings.workspaces, ['dev', 'wordpress'], 'the second activation still read the first');
  // The bash tooling reads the same list (the smoke test walks it): a folder name is written bare, since
  // parse_yaml keeps the quotes of a quoted item.
  assert.match(text, /^workspaces:\n  - dev\n  - wordpress$/m);
  const bash = require('child_process').spawnSync('bash', ['-c', `source ${path.join(__dirname, '..', '..', '..', 'scripts', 'libs', 'bash-yaml.sh')} ; eval $(parse_yaml ${file}) ; printf '%s,' "\${workspaces[@]}"`], { encoding: 'utf8' });
  assert.strictEqual(bash.stdout, 'dev,wordpress,');
  upsertSettingsList('settings.yml', 'odd', ['*.md', 'true', '12', 'two words', 'plain-word']);
  assert.match(fs.readFileSync(file, 'utf8'), /odd:\n  - "\*\.md"\n  - "true"\n  - "12"\n  - "two words"\n  - plain-word\n/);
  assert.deepStrictEqual(yaml.load(fs.readFileSync(file, 'utf8')).odd, ['*.md', 'true', '12', 'two words', 'plain-word']);
  fs.writeFileSync(file, 'a: 1\nplugins: {}   # none yet\n');
  upsertSettingsValue('settings.yml', 'plugins.x.enabled', true);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'a: 1\nplugins:   # none yet\n  x:\n    enabled: true\n', 'the comment on the line stays');
});

test('upsertSettingsList replaces a list in place, creates one that is missing, and quotes what YAML would misread', () => {
  const { upsertSettingsList } = require('../../settings-file');
  const file = path.join(TMP, 'settings.yml');
  fs.writeFileSync(file, 'a: 1\n\ngoogle_drive:\n  account: me  # keep\n  targets:\n    videos:\n      - "*.mp4"\n      - "*.mov"\n    docs:\n      - "*.pdf"\n  exclude:\n    - node_modules\n\nz: 2\n');
  upsertSettingsList('settings.yml', 'google_drive.targets.videos', ['*.mp4', '*-poster.jpg', 'clips/']);
  upsertSettingsList('settings.yml', 'google_drive.targets.specs', ['*.md']);          // a new list beside the others
  upsertSettingsList('settings.yml', 'google_drive.targets.docs', []);                  // emptied
  upsertSettingsList('settings.yml', 'brand_new.list', ['x']);                          // a new block
  const y = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(y.google_drive.targets.videos, ['*.mp4', '*-poster.jpg', 'clips/']);
  assert.deepStrictEqual(y.google_drive.targets.specs, ['*.md']);
  assert.deepStrictEqual(y.google_drive.targets.docs, []);
  assert.deepStrictEqual(y.google_drive.exclude, ['node_modules'], 'the list after it is untouched');
  assert.deepStrictEqual(y.brand_new.list, ['x']);
  assert.strictEqual(y.z, 2);
  assert.match(fs.readFileSync(file, 'utf8'), /account: me  # keep/);
});
