/**
 * SSH keys into the agent container every project borrows them from.
 *
 * Without it, a `composer install` that needs a private repository fails at the first package nobody
 * can read — and the fix is a command in a terminal that nothing in the dashboard mentions.
 *
 * It is also the ONE verb here that needs a person at the keyboard: `ssh-add` asks for the key's
 * passphrase. So it runs in a screen session, which this dashboard can already open a terminal onto,
 * and the menu item says to go and answer it. As a fire-and-forget button it would look like a
 * command that silently did nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

test('it runs where somebody can answer it', () => {
  assert.match(ddev, /'\/actions\/ddev-auth-ssh':[^\n]*args: \['auth', 'ssh'\]/);
  assert.match(ddev, /'\/actions\/ddev-auth-ssh':[^\n]*inScreen: true/,
    'a prompt in a detached job is a prompt nobody can answer');
  assert.match(actions, /'\/actions\/ddev-auth-ssh': ddev_verb,/);
  // It is not tied to one project being up: the agent container is global, and a key added from any
  // project is a key every project has.
  assert.ok(!/'\/actions\/ddev-auth-ssh':[^\n]*needsRunning: true/.test(ddev));
});

test('the item says a passphrase is waiting, and where', () => {
  const item = server.slice(server.indexOf('Add my SSH keys'), server.indexOf('Add my SSH keys') + 200);
  assert.match(server, /then answer the passphrase in Screens/);
  assert.ok(item.length > 0);
  // The row already raises a hand for a session that is waiting for input, so the two features meet:
  // this is the one action that will reliably raise it.
  assert.match(server, /title="Add your SSH keys to the agent container every project borrows them from/);
});
