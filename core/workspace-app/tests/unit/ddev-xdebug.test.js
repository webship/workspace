/**
 * Step debugging, on and off, from the row.
 *
 * `ddev xdebug on` is a toggle inside the web container — no config change, no restart — which is
 * exactly why it belongs on a menu rather than in somebody's shell history. And Xdebug costs about
 * 3x the PHP runtime while it is on, so turning it OFF is the half people forget.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

test('all three verbs are the CLI\'s own', () => {
  // `ddev xdebug on|off|status`, as `ddev xdebug --help` documents them.
  assert.match(ddev, /'\/actions\/ddev-xdebug-on':[^\n]*args: \['xdebug', 'on'\]/);
  assert.match(ddev, /'\/actions\/ddev-xdebug-off':[^\n]*args: \['xdebug', 'off'\]/);
  assert.match(ddev, /'\/actions\/ddev-xdebug-status':[^\n]*args: \['xdebug', 'status'\]/);
  for (const a of ['on', 'off', 'status']) {
    assert.match(actions, new RegExp(`'/actions/ddev-xdebug-${a}': ddev_verb,`), a);
    // The container has to be up for a toggle inside it to mean anything.
    assert.match(ddev, new RegExp(`'/actions/ddev-xdebug-${a}':[^\\n]*needsRunning: true`), a);
  }
});

test('the menu offers both states rather than a toggle', () => {
  // `ddev describe --json-output` carries no xdebug field — checked — so a row cannot show the
  // current state without a subprocess of its own. Both are offered, and asking is a click.
  const menu = server.slice(server.indexOf('<li class="uk-nav-header">debugging</li>'));
  assert.match(menu.slice(0, 1200), /Xdebug on/);
  assert.match(menu.slice(0, 1200), /Xdebug off/);
  assert.match(menu.slice(0, 1200), /Which is it now\?/);
  assert.ok(!/xdebug-toggle/.test(server), 'no toggle, because the state is not known');
  // And the cost of leaving it on is on the item itself, not in a doc nobody opens.
  assert.match(menu.slice(0, 1200), /3&times; slower/);
});
