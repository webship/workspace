/**
 * A plugin's state says what is missing (#433).
 *
 * Settings called a plugin "Ready" while the command it needs was not on this machine (Lando, Docksal and
 * Podman with no lando, fin or podman; AWS once its keys were typed in, with no aws), and "Needs settings"
 * said "Its settings are not filled in yet" whichever key still held the placeholder.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const model = require('../../settings-model.mts');
const { placeholderKeys } = require('../../plugins-page');

const none = { unmet: [], problems: [] };
const row = (name, step, more = {}) => ({ name, module: `@webship.co/workspace-${name}`, version: '1.0.0', manifest: { name }, wants: none, step, ...more });
const cmd = (name, state, kind = 'needs') => ({ owner: 'x', kind, anyOf: [name], name, state, where: 'host' });

test('a needed command that is not on this machine is the state, with the way to install it', () => {
  const s = model.stateOf(row('lando', 3, { commands: [cmd('lando', 'missing')] }));
  assert.deepStrictEqual([s.id, s.label, s.tone, s.attention, s.active], ['needs-command', 'Needs lando', 'warning', true, true]);
  assert.strictEqual(s.note, 'lando is not on this machine');
  assert.deepStrictEqual(s.action, { kind: 'link', href: '/settings/plugin/lando#needs', label: 'How to install' });
  const two = model.stateOf(row('cpanel', 3, { commands: [cmd('ssh', 'missing'), cmd('rsync', 'missing'), cmd('curl', 'found')] }));
  assert.deepStrictEqual([two.label, two.note], ['Needs ssh and rsync', 'ssh and rsync are not on this machine']);
});

test('a command that is found, could not be checked, or is only suggested leaves the plugin Ready', () => {
  for (const commands of [[cmd('docker', 'found')], [cmd('upsun', 'unchecked')], [cmd('pg_dump', 'missing', 'suggests')], undefined]) {
    assert.strictEqual(model.stateOf(row('x', 3, { commands })).id, 'ready', JSON.stringify(commands));
  }
});

test('settings come first, and the note names the keys still on the placeholder and the missing command', () => {
  const s = model.stateOf(row('upsun', 2, { todo: ['cli_token'], commands: [cmd('upsun', 'missing')] }));
  assert.deepStrictEqual([s.id, s.label, s.action.href], ['needs-settings', 'Needs settings', '/settings/plugin/upsun#settings']);
  assert.strictEqual(s.note, 'Still the placeholder: cli_token; upsun is not on this machine');
  assert.strictEqual(model.stateOf(row('jira', 2, { todo: ['site', 'account', 'default_project'] })).note, 'Still the placeholder: site, account, default_project');
  assert.strictEqual(model.stateOf(row('jira', 2)).note, 'Its settings are not filled in yet', 'no file yet: no key to name');
});

test('the keys on the placeholder are read from the file, nested ones dotted, comments and lists not', () => {
  const text = [
    '# Fill in CHANGE_ME below.',
    'site: "https://CHANGE_ME.atlassian.net"',
    'account: you@example.com',
    'api_tokens:',
    '  # webshipco: CHANGE_ME',
    '  CHANGE_ME_USER: CHANGE_ME',
    'git:',
    '  token: CHANGE_ME   # a comment',
    '  host: example.invalid',
    'list:',
    '  - one',
    '',
  ].join('\n');
  assert.deepStrictEqual(placeholderKeys(text), ['site', 'api_tokens.CHANGE_ME_USER', 'git.token']);
  assert.deepStrictEqual(placeholderKeys('a: b\n# CHANGE_ME\n'), []);
});

test('the plugin page says it at the top, with the way to the install hint', () => {
  const { statusHtml } = require('../../settings-plugin-page');
  const p = row('lando', 3, { commands: [cmd('lando', 'missing')], family: 'containers', label: 'Lando', placed: { installed: true }, loaded: true });
  p.state = model.stateOf(p);
  const html = statusHtml(p);
  assert.match(html, /<span>Needs lando<\/span>/);
  assert.match(html, /<div class="plugin-alert is-warning" role="status">/);
  assert.match(html, /<strong>Needs lando\.<\/strong> lando is not on this machine\. <a href="\/settings\/plugin\/lando#needs">How to install<\/a>\./);
});
