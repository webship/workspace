/**
 * The default accounts of every distribution (`--add-users`, cmd-tools-add-users.sh) can be created.
 *
 * Each list is read from set_<distribution>_users in fun-distribution-<distribution>.sh by bash itself.
 * The Website and Webship lists had a "Webmaster" account: the installer's own account is `webmaster`,
 * user names are case-insensitive, so `drush user:create` answered "There is already a user account
 * with the name Webmaster" and the account never existed.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const FUNCTIONS = path.join(SCRIPTS, 'functions');
const SETTINGS = path.join(SCRIPTS, '..', 'config', 'settings.template.yml');

/** The accounts of one distribution: [{ key, name, mail, password, role }]. */
function usersOf(distribution) {
  const script = `
ddev() { :; }
source ${FUNCTIONS}/fun-distribution-${distribution}.sh
set_${distribution}_users
for user in "\${users[@]}"; do
  n="user_\${user}_name"; m="user_\${user}_mail"; p="user_\${user}_password"; r="user_\${user}_role"
  printf '%s|%s|%s|%s|%s\\n' "\${user}" "\${!n}" "\${!m}" "\${!p}" "\${!r}"
done`;
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return run.stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [key, name, mail, password, role] = line.split('|');
    return { key, name, mail, password, role };
  });
}

const distributions = fs.readdirSync(FUNCTIONS)
  .map((f) => (f.match(/^fun-distribution-([a-z0-9_]+)\.sh$/) || [])[1])
  .filter((d) => d && fs.readFileSync(path.join(FUNCTIONS, `fun-distribution-${d}.sh`), 'utf8').includes(`set_${d}_users()`));

// The account the installer creates: account.name in settings.yml.
const installer = (fs.readFileSync(SETTINGS, 'utf8').match(/^account:\n(?:[ \t]+.*\n)*?[ \t]+name:[ \t]*(\S+)/m) || [])[1];

test('the installer account and the distributions with a user list are found', () => {
  assert.strictEqual(installer, 'webmaster');
  for (const d of ['drupal', 'drupal_cms', 'webship', 'website', 'webships', 'cucumber']) assert.ok(distributions.includes(d), d);
});

for (const distribution of distributions) {
  test(`${distribution}: every default account is complete, and no name is taken`, () => {
    const users = usersOf(distribution);
    assert.ok(users.length > 0, 'the list is not empty');
    for (const u of users) {
      assert.ok(u.name && u.mail && u.password && u.role, `${u.key} misses a value: ${JSON.stringify(u)}`);
      assert.notStrictEqual(u.name.toLowerCase(), installer.toLowerCase(), `"${u.name}" is the installer's account: user names are case-insensitive`);
    }
    const names = users.map((u) => u.name.toLowerCase());
    assert.strictEqual(new Set(names).size, names.length, `two accounts share a name: ${names.join(', ')}`);
    const mails = users.map((u) => u.mail.toLowerCase());
    assert.strictEqual(new Set(mails).size, mails.length, `two accounts share a mail: ${mails.join(', ')}`);
  });
}
