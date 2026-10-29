/**
 * Screen session names (jobs.js). A name is workspace--project--verb, at most 60 characters. It used to
 * be cut at 60, so on a long project name two commands shared one session: one was refused as "still
 * running", or replaced the other's output. What must never drift: a name that fits is exactly what it
 * always was; one that does not stays within 60, unique, stable, with the workspace in front and the verb
 * whole at the end.
 */

const assert = require('node:assert');
const { test } = require('node:test');

const { screenSessionName } = require('../../jobs');

// The name as it was built before, for every case where it fitted.
const before = (project, verb, workspace) => [workspace, project, verb].filter(Boolean).join('--')
  .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').replace(/^-+|-+$/g, '').slice(0, 60);

test('a name that fits is exactly what it always was', () => {
  for (const [p, v, w] of [
    ['site1', 'composer-update', 'dev'], ['my-drupal-site-rightup', 'custom-say-hello', 'dev'],
    ['ace_editor', 'yarn-install', 'products'], ['vb11t1', 'tests', 'test'], ['x', 'jira-varbase-1234', 'dev'],
    ['Some Name', 'git-status', 'dev'], ['', 'exec', 'dev'],
  ]) {
    assert.ok(before(p, v, w).length <= 60);
    assert.strictEqual(screenSessionName(p, v, w), before(p, v, w));
  }
});

test('the real collisions are gone: every command on a long project gets its own session', () => {
  const cases = [
    ['entity-definition-update-manager', 'products', ['composer-update-dry-run', 'composer-update-lock', 'composer-update-package', 'composer-update']],
    ['entity_browser_generic_embed_plugins', 'products', ['composer-show', 'composer-show-tree', 'composer-require', 'composer-require-dev']],
    ['paragraphs_asymmetric_translation_widgets', 'products', ['yarn-install', 'yarn-ci', 'npm-install', 'git-status', 'git-stashes']],
    ['amd-horizonaid-1-0-x-site-template', 'dev', ['custom-update-database', 'custom-update-database-staging']],
  ];
  for (const [p, w, verbs] of cases) {
    const names = verbs.map((v) => screenSessionName(p, v, w));
    assert.strictEqual(new Set(names).size, names.length, `${w}/${p}: ${names.join(' | ')}`);
    names.forEach((n, i) => {
      assert.ok(n.length <= 60, `${n} is ${n.length} characters`);
      assert.match(n, /^[a-z0-9._-]+$/);
      assert.ok(n.startsWith(`${w}--`), `the workspace stays in front: ${n}`);
      assert.ok(n.endsWith(`--${verbs[i]}`), `the verb stays whole at the end: ${n}`);
      assert.strictEqual(screenSessionName(p, verbs[i], w), n, 'the same name every time');
    });
  }
});

test('a Jira key is still read from the end of a long name, and the workspace is still in front', () => {
  const n = screenSessionName('paragraphs_asymmetric_translation_widgets', 'jira-varbase-12345', 'products');
  assert.ok(n.length <= 60);
  assert.ok(n.startsWith('products--'), n);
  // screens.js reads the key with exactly this pattern; a name cut at 60 lost the end of it.
  assert.strictEqual((n.match(/(?:^|--)jira-([a-z0-9]+-[0-9]+)$/) || [])[1], 'varbase-12345');
});

test('a verb too long to keep whole still gives a short, unique, stable name', () => {
  const long = 'custom-an-action-with-a-very-long-identifier-indeed-x';
  const a = screenSessionName('paragraphs_asymmetric_translation_widgets', `${long}1`, 'products');
  const b = screenSessionName('paragraphs_asymmetric_translation_widgets', `${long}2`, 'products');
  assert.ok(a.length <= 60 && b.length <= 60);
  assert.notStrictEqual(a, b);
  assert.ok(a.startsWith('products--'));
});
