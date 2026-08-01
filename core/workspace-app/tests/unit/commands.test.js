/**
 * The commands view: that it sees the whole tree, and that it will not open something that is not
 * a command in a workspace that does not exist.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { listAllCommands, commandFile, toolingRepo, SCRIPT_RE } = require('../../commands');

test('it finds commands across the whole workspace, not one folder', () => {
  const all = listAllCommands();
  assert.ok(all.length > 50, `expected many commands, found ${all.length}`);
  assert.ok(new Set(all.map((c) => c.workspace)).size > 5, 'commands should come from several workspaces');
});

test('every row carries the workspace it runs from', () => {
  // cmd-tools-remove.sh exists in five workspaces and they are not the same file, so a row
  // without its workspace is ambiguous.
  for (const c of listAllCommands()) {
    assert.ok(c.workspace, `${c.name} has no workspace`);
    assert.match(c.name, SCRIPT_RE);
  }
});

test('a builder offers what it builds, from its own header', () => {
  const labelled = listAllCommands().filter((c) => c.label);
  assert.ok(labelled.length > 5, 'builders carry a # workspace-name: header');
});

test('a file outside the workspace cannot be opened', () => {
  assert.equal(commandFile('dev', '../../etc/passwd'), null);
  assert.equal(commandFile('dev', 'notacommand.txt'), null);
  assert.equal(commandFile('no-such-workspace', 'cmd-tools-remove.sh'), null);
});

test('a real command resolves to a real file', () => {
  const one = listAllCommands()[0];
  assert.ok(commandFile(one.workspace, one.name), `${one.workspace}/${one.name} should resolve`);
});

test('the tooling repository comes from settings, not from a constant', () => {
  const t = toolingRepo();
  assert.ok(t.repo.includes('/'), 'a repo is owner/name');
  assert.ok(t.ref, 'a ref is needed to compare against');
});

test('rows carry where their workspace sits, so the list can be grouped in card order', () => {
  const { loadWorkspaces } = require('../../workspaces');
  const order = Object.keys(loadWorkspaces());
  for (const c of listAllCommands()) {
    assert.equal(typeof c.groupRank, 'number', `${c.name} has no group rank`);
    assert.equal(c.groupRank, order.indexOf(c.workspace));
  }
});

test('the group sort orders by workspace, then by name within one', () => {
  const { SORTS } = require('../../lists');
  const rows = [
    { name: 'cmd-b.sh', groupRank: 0 },
    { name: 'cmd-a.sh', groupRank: 1 },
    { name: 'cmd-a.sh', groupRank: 0 },
  ];
  const sorted = rows.slice().sort(SORTS.group.cmp);
  assert.deepEqual(sorted.map((r) => `${r.groupRank}/${r.name}`),
    ['0/cmd-a.sh', '0/cmd-b.sh', '1/cmd-a.sh']);
});

test('the sort comparator sees the whole row, not a copy of two fields', () => {
  // Rebuilding the row before comparing is how a sort on anything but name or mtime silently
  // became a sort on name.
  const { searchSortPage, defaultListState } = require('../../lists');
  const rows = [{ name: 'z', groupRank: 0 }, { name: 'a', groupRank: 1 }];
  const page = searchSortPage(rows, { ...defaultListState(), sort: 'group', per: 'all' });
  assert.deepEqual(page.slice.map((r) => r.name), ['z', 'a'], 'groupRank should have decided this');
});
