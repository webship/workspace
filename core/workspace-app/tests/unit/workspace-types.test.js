/**
 * The type layer: policy over which actions a workspace's project rows offer.
 *
 * The promise pinned here is "nothing changes until somebody edits a type" — every shipped
 * folder must resolve to a default that carries exactly the interface it had before types
 * existed, and an explicit `type:` must win over that default.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { TYPES, DEFAULT_TYPE_BY_KEY, isType, resolveType, typeActions } = require('../../workspace-types');
const { loadWorkspaces, CONFIG_DIR } = require('../../workspaces');

test('every default points at a real type', () => {
  for (const [key, type] of Object.entries(DEFAULT_TYPE_BY_KEY)) {
    assert.ok(isType(type), `${key} defaults to unknown type '${type}'`);
  }
});

test('an explicit type wins, a bad one falls back, kind decides the rest', () => {
  assert.equal(resolveType('dev', 'code', 'projects'), 'code');
  assert.equal(resolveType('dev', 'not-a-type', 'projects'), 'sites');
  assert.equal(resolveType('brand-new', undefined, 'files'), 'files');
  assert.equal(resolveType('brand-new', undefined, 'projects'), 'sites');
});

test('sites carry the full toolbelt, code drops the site controls, lists carry none', () => {
  const sites = typeActions('sites');
  for (const a of ['build', 'ddev', 'backup', 'remove', 'ragify', 'tests', 'checks', 'users']) {
    assert.ok(sites.has(a), `sites misses ${a}`);
  }
  const code = typeActions('code');
  for (const a of ['ddev', 'users', 'tests']) assert.ok(!code.has(a), `code should not carry ${a}`);
  for (const a of ['backup', 'remove', 'ragify', 'checks']) assert.ok(code.has(a), `code misses ${a}`);
  // Lists carry no project actions; files and media take only New folder, a page action.
  for (const t of ['files', 'media']) assert.deepEqual([...typeActions(t)], ['folder'], `${t} should carry only folder`);
  assert.equal(typeActions('ai-items').size, 0, 'ai-items should carry no actions');
});

test('every loaded workspace resolves a type and its action set', () => {
  for (const [key, meta] of Object.entries(loadWorkspaces())) {
    assert.ok(isType(meta.type), `${key} resolved to unknown type '${meta.type}'`);
    assert.ok(meta.typeActions instanceof Set, `${key} has no typeActions set`);
    // files-kind pages have no project rows to act on — their types agree.
    if (meta.kind === 'files' && !meta.alsoFiles) {
      assert.equal(meta.typeActions.has('ddev'), false, `${key} is a file list but allows ddev`);
    }
  }
});

test('the settings dropdown and the registry cannot drift', () => {
  const fs = require('fs');
  const path = require('path');
  const labels = fs.readFileSync(path.join(CONFIG_DIR, 'settings.labels.yml'), 'utf8');
  for (const type of Object.keys(TYPES)) {
    assert.ok(labels.includes(`    ${type}:`), `settings.labels.yml type options miss '${type}'`);
  }
});

test('a plugin can allow its action on the types it names, and only there', () => {
  const { addTypeAction } = require('../../workspace-types');
  addTypeAction('x-cloud', ['sites']);
  assert.ok(typeActions('sites').has('x-cloud'));
  assert.ok(!typeActions('code').has('x-cloud'));
  addTypeAction('x-cloud', ['sites']);
  assert.strictEqual([...typeActions('sites')].filter((a) => a === 'x-cloud').length, 1, 'registered once');
});
