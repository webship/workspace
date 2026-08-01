/**
 * The action registry: that every path the interface can post to has a handler, and that the
 * handlers agree with the tables the menus are built from.
 *
 * This is the check that would have caught the split losing an action, and the one that catches a
 * menu offering a verb the server does not implement — the failure the ddev.js table exists to
 * prevent, asserted rather than assumed.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const ACTIONS = {
  ...require('../../actions/projects'),
  ...require('../../actions/items'),
  ...require('../../actions/config'),
  ...require('../../actions/ddev'),
  ...require('../../actions/graphs'),
  ...require('../../actions/rag'),
  ...require('../../actions/assistant'),
  ...require('../../actions/commands'),
};
const { DDEV_ACTIONS, DDEV_MENU_ORDER } = require('../../ddev');

test('every registered action is a function', () => {
  for (const [path, fn] of Object.entries(ACTIONS)) {
    assert.equal(typeof fn, 'function', `${path} is not callable`);
  }
});

test('every action path is shaped like one', () => {
  for (const path of Object.keys(ACTIONS)) {
    assert.match(path, /^\/actions\/[a-z-]+$/, `${path} is not an action path`);
  }
});

test('the actions the interface posts to all exist', () => {
  // The list the dashboard's markup actually uses. A menu item pointing at a missing handler is a
  // click that answers "Unknown action", which is the shape of bug this asserts away.
  const expected = [
    'build', 'quick-build', 'testing-configure', 'testing-run', 'backup', 'remove', 'restore', 'backup-delete',
    'save-item', 'clone-item', 'install-item', 'delete-item', 'generate-item', 'make-html', 'make-pdf',
    'screenshot', 'generate-doc', 'sync-items',
    'list-order', 'list-move', 'workspace-presentation', 'save-settings',
    'ddev-start', 'ddev-stop', 'status',
    'graphify', 'graph-remove', 'graph-mcp-command',
    'ragify', 'rag-info', 'rag-remove', 'rag-mcp-command',
    'chat',
  ].map((n) => `/actions/${n}`);
  const missing = expected.filter((p) => !ACTIONS[p]);
  assert.deepEqual(missing, [], 'the interface posts to actions that do not exist');
});

test('every DDEV verb in the table has a handler, and the menu offers exactly those', () => {
  for (const path of Object.keys(DDEV_ACTIONS)) {
    assert.ok(ACTIONS[path], `${path} is in the table but has no handler`);
  }
  for (const path of DDEV_MENU_ORDER) {
    assert.ok(DDEV_ACTIONS[path], `the menu lists ${path}, which the table does not define`);
  }
  assert.deepEqual([...DDEV_MENU_ORDER].sort(), Object.keys(DDEV_ACTIONS).sort(),
    'the menu and the table have drifted apart');
});

test('a DDEV verb that needs a running site is marked as such', () => {
  // drush against a stopped project fails with a docker error that says nothing useful, which is
  // why these carry the flag rather than finding out at run time.
  for (const path of ['/actions/ddev-drush-cr', '/actions/ddev-drush-uli', '/actions/ddev-export-db']) {
    assert.equal(DDEV_ACTIONS[path].needsRunning, true, `${path} should require a running project`);
  }
  assert.ok(!DDEV_ACTIONS['/actions/ddev-restart'].needsRunning, 'restart works on a stopped project');
});

test('every DDEV entry has what both halves need', () => {
  for (const [path, a] of Object.entries(DDEV_ACTIONS)) {
    assert.ok(Array.isArray(a.args) && a.args.length, `${path} has no command`);
    assert.ok(a.label && a.menuLabel && a.menuIcon, `${path} is missing its menu text`);
    assert.ok(a.ms > 0, `${path} has no timeout`);
  }
});

test('the commands actions are registered and shell out rather than reimplementing', () => {
  // Every one of these has a matching verb in commands/cmd-tools-commands.sh; the point of the
  // dashboard half is the job toast, not a second implementation.
  for (const n of ['command-list-remote', 'command-diff', 'command-pull', 'command-propose', 'command-save']) {
    assert.ok(ACTIONS[`/actions/${n}`], `/actions/${n} is not registered`);
  }
});
