/**
 * A key with the word `secret` in its name is a secret (#431).
 *
 * The AWS plugin's `secret_access_key` matched none of the secret rules (a name like `secret`, or a suffix
 * like `_secret`, `_token`), so Settings → Plugins → AWS showed the AWS secret access key in a text field
 * and in the page source, `plugins.sh --configure aws` printed it, and the raw editor sent it unmasked.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-secret-word-'));
process.env.WORKSPACE_CONFIG = TMP;
const { isSecretKey, readSettingsRows, readSettingsText, settingsTextForTerminal, SECRET_MASK } = require('../../settings-file');

const AWS = [
  '# The named profile in ~/.aws the dashboard and the tool use.',
  'profile: default',
  'region: eu-west-1',
  '# An IAM access key for the dashboard. Read by the CLI as AWS_ACCESS_KEY_ID.',
  'access_key_id: AKIAEXAMPLEKEYID0000',
  '# The secret of that key. Read by the CLI as AWS_SECRET_ACCESS_KEY.',
  'secret_access_key: r9-not-a-real-secret',
  '',
].join('\n');

test('every name with the word secret in it is a secret; the key id, a switch about secrets and a map key are not', () => {
  for (const key of ['secret_access_key', 'client_secret', 'api_secret', 'secret_key', 'secret', 'SECRET_ACCESS_KEY', 'my_secret_value']) {
    assert.strictEqual(isSecretKey(key, key), true, key);
  }
  for (const key of ['access_key_id', 'scan_for_secrets', 'secretary', 'region', 'profile']) {
    assert.strictEqual(isSecretKey(key, key), false, key);
  }
});

test("the AWS settings file: the secret access key is masked in the form's rows, for the terminal and for the raw editor", () => {
  fs.writeFileSync(path.join(TMP, 'plugin.aws.settings.yml'), AWS);
  const rows = Object.fromEntries(readSettingsRows('plugin.aws.settings.yml').map((r) => [r.key, r]));
  assert.strictEqual(rows.secret_access_key.secret, true);
  assert.strictEqual(rows.access_key_id.secret, false);
  const terminal = settingsTextForTerminal('plugin.aws.settings.yml');
  assert.match(terminal, /^secret_access_key: <hidden>$/m);
  assert.ok(!terminal.includes('r9-not-a-real-secret'));
  assert.match(terminal, /^access_key_id: AKIAEXAMPLEKEYID0000$/m);
  const raw = readSettingsText('plugin.aws.settings.yml');
  assert.ok(!raw.text.includes('r9-not-a-real-secret'), 'the raw editor never gets it');
  assert.ok(raw.text.includes(`secret_access_key: ${SECRET_MASK}`));
});
