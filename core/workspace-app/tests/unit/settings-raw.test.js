/**
 * Editing a settings file as raw YAML, beside the field-by-field form.
 *
 * The form is the safer way and stays the default: it edits one value on one known line and leaves the
 * comments, the quoting and the list blocks exactly as they were. But some changes are not a value — a
 * key that does not exist yet, a block moved, a comment written for the next person — and for those the
 * form has no answer at all.
 *
 * The rule it must not break is the one the whole settings editor is built around: **a secret's value
 * never leaves the server.** A raw editor sends the whole file out and takes the whole file back, so
 * every secret goes out wearing a mask and any value still wearing it comes back as what is on disk.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-raw-'));
process.env.WORKSPACE_CONFIG = tmp;
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const sf = require('../../settings-file');
const { CONFIG_DIR } = require('../../workspaces');

// A fixture, not the machine's own settings: these tests must never read a real token, and a test that
// writes over somebody's configuration to prove it can write is not a test anyone should run twice.
const FIXTURE = `# The hub settings.
account:
  # The admin username a fresh install is created with.
  user: webmaster
  pass: not-a-secret-by-design
figma:
  token: fig-abc
git:
  github:
    token: gh-one
  drupal:
    token: dr-two
  bitbucket:
    token: bb-three
style:
  mode: light          # light | dark | system
workspaces:
  - dev
  - test
`;

const FILE = 'settings.yml';
const full = path.join(CONFIG_DIR, FILE);
const restore = () => fs.writeFileSync(full, FIXTURE);
restore();

test('every secret leaves wearing a mask, and its value does not', () => {
  restore();
  const read = sf.readSettingsText(FILE);
  assert.ok(read, 'the file is readable');
  const rows = sf.readSettingsRows(FILE).filter((r) => r.secret && r.value.trim());
  assert.strictEqual(rows.length, 4, 'the fixture holds four secrets — and account.pass is not one of them');
  const out = read.text.split('\n');
  for (const r of rows) {
    assert.ok(read.masked.includes(r.dotted), `${r.dotted} is masked`);
    assert.ok(out[r.line].includes(sf.SECRET_MASK), `${r.dotted}'s line carries the mask`);
    assert.ok(!out[r.line].includes(r.value), `${r.dotted}'s value is not on its line`);
  }
});

test('the mask is visible and unlikely to be typed by accident', () => {
  // A row of dots would look like a value somebody had set.
  assert.match(sf.SECRET_MASK, /kept/);
  assert.ok(sf.SECRET_MASK.length > 8);
});

test('a file saved back unchanged is byte for byte what it was', () => {
  restore();
  const before = fs.readFileSync(full, 'utf8');
  const { text } = sf.readSettingsText(FILE);
  const res = sf.writeSettingsText(FILE, text, { yaml });
  assert.ok(res.kept.length, 'it says which secrets it put back');
  assert.strictEqual(fs.readFileSync(full, 'utf8').trimEnd(), before.trimEnd(),
    'comments, order, quoting and every secret survive a round trip');
  restore();
});

test('a masked secret is matched by its whole path, not by its key', () => {
  // Three services each have a key called `token`. Matching by key gave all three the first one's
  // value — one service's token copied onto another.
  fs.writeFileSync(full, [
    'git:', '  github:', '    token: gh-one', '  drupal:', '    token: dr-two', '  bitbucket:', '    token: bb-three', '',
  ].join('\n'));
  const { text, masked } = sf.readSettingsText(FILE);
  assert.deepStrictEqual(masked, ['git.github.token', 'git.drupal.token', 'git.bitbucket.token']);
  assert.strictEqual((text.match(new RegExp(sf.SECRET_MASK.replace(/[.*+?^${}()|[\]\\<>—]/g, '\\$&'), 'g')) || []).length, 3);
  sf.writeSettingsText(FILE, text, { yaml });
  const back = fs.readFileSync(full, 'utf8');
  assert.match(back, /github:\n\s+token: gh-one/);
  assert.match(back, /drupal:\n\s+token: dr-two/);
  assert.match(back, /bitbucket:\n\s+token: bb-three/);
  restore();
});

test('typing over the mask is how a new secret is set', () => {
  fs.writeFileSync(full, 'git:\n  github:\n    token: old-one\n');
  const { text } = sf.readSettingsText(FILE);
  sf.writeSettingsText(FILE, text.replace(sf.SECRET_MASK, 'a-new-one'), { yaml });
  assert.match(fs.readFileSync(full, 'utf8'), /token: a-new-one/);
  restore();
});

test('a masked value with nothing behind it is written empty, never as the mask', () => {
  fs.writeFileSync(full, 'git:\n  github:\n    token: old-one\n');
  const { text } = sf.readSettingsText(FILE);
  // The key was renamed while the mask was still on it: there is no value to put back.
  sf.writeSettingsText(FILE, text.replace('token:', 'other_token:'), { yaml });
  const back = fs.readFileSync(full, 'utf8');
  assert.ok(!back.includes(sf.SECRET_MASK), 'the mask never reaches the file');
  assert.match(back, /other_token:\s*$/m);
  restore();
});

test('a file that does not parse is refused, and nothing is written', () => {
  restore();
  const before = fs.readFileSync(full, 'utf8');
  const res = sf.writeSettingsText(FILE, 'a: 1\n  : : no\n', { yaml });
  assert.match(res.error, /not YAML/);
  assert.strictEqual(fs.readFileSync(full, 'utf8'), before,
    'a settings file that does not parse takes the whole configuration with it');
});

test('an empty file, and a file that is not a mapping, are refused too', () => {
  restore();
  const before = fs.readFileSync(full, 'utf8');
  assert.match(sf.writeSettingsText(FILE, '   ', { yaml }).error, /empty file/);
  assert.match(sf.writeSettingsText(FILE, '- one\n- two\n', { yaml }).error, /mapping/);
  assert.strictEqual(fs.readFileSync(full, 'utf8'), before);
});

test('a file that cannot be read is null, not an empty editor', () => {
  assert.strictEqual(sf.readSettingsText('workspace.nosuchthing.settings.yml'), null);
});

/* ------------------------------------------------------------------ *
 * How it is wired
 * ------------------------------------------------------------------ */

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('both ways are offered on every settings file, and fields is the default', () => {
  assert.match(server, /function settingsModesHtml\(file, raw\)/);
  assert.match(server, /'Fields', !raw/);
  assert.match(server, /'Raw YAML', raw/);
  assert.match(server, /\?raw=1/);
  assert.match(server, /const raw = new URL\(req\.url, 'http:\/\/localhost'\)\.searchParams\.get\('raw'\) === '1';/);
});

test('the raw save carries the mtime, and is refused when the file changed underneath', () => {
  assert.match(server, /if \(String\(form\.mtime \|\| ''\) !== String\(mtime\)\) \{/);
  assert.match(server, /That file changed since this editor was opened — nothing was written/);
  assert.match(server, /, 409\)/);
});

test('a refusal keeps what was typed', () => {
  assert.match(server, /a refusal that threw away what was typed would be worse/);
  assert.match(server, /settingsRawHtml\(file, `<div class="msg error">\$\{esc\(result\.error\)\}/);
});

test('only a settings file can be written this way', () => {
  const block = server.slice(server.indexOf("pathname === '/actions/save-settings-raw'"), server.indexOf("pathname === '/actions/save-settings'"));
  assert.match(block, /if \(!SETTINGS_FILE_RE\.test\(file\)\)/);
  assert.match(block, /Ambiguous request/, 'a duplicated file field is refused rather than guessed at');
});

test('the action is logged once, by the central audit, so no secret reaches the log twice', () => {
  assert.match(server, /No audit\(\) call: every action is already logged centrally/);
});
