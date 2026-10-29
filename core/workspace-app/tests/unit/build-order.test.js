/**
 * Settings → Command order: the order of a workspace's builders and tools.
 *
 * The part worth testing hardest is not the sorting — it is what gets WRITTEN. A page that recorded all
 * forty rows every time you moved one would freeze the order of everything nobody has an opinion about,
 * so a command added next month would land at the bottom instead of in its shipped place. The first
 * attempt at that compared positions and got it exactly wrong: moving one builder from the bottom to
 * the top shifts every other row down by one, so nothing sits where the defaults put it and all forty
 * names look like decisions. One move wrote twenty-five lines. That is what `minimalOrder` is for, and
 * what most of this file is about.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A file of its own per run, so these never touch the machine's own order.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-order-'));
process.env.BUILD_ORDER_FILE = path.join(TMP, 'build-order.yml');

const order = require('../../build-order');

const B = {
  d11: 'cmd-drupal11-recommended-project.sh',
  d12: 'cmd-drupal12-recommended-project.sh',
  cms: 'cmd-drupalcms2-x-project.sh',
  vb11x: 'cmd-varbase11-0-x-project.sh',
  vb91x: 'cmd-varbase9-1-x-project.sh',
  educare: 'cmd-educare1-0-x-project.sh',
  cmsEducare: 'cmd-drupalcms2-x-educare1-0-x-project.sh',
  testing: 'cmd-automated-testing-varbase11-0-x-project.sh',
};
const T = {
  backup: 'cmd-tools-backup-dev.sh',
  clone: 'cmd-tools-clone.sh',
  upsun: 'cmd-tools-upsun.sh',
};

const write = (obj) => fs.writeFileSync(process.env.BUILD_ORDER_FILE, require('js-yaml').dump(obj));
const clear = () => { try { fs.unlinkSync(process.env.BUILD_ORDER_FILE); } catch (_) { /* gone */ } };

test('a builder is a cmd-*-project.sh; a tool is every other command', () => {
  assert.ok(order.isBuilder(B.d12));
  assert.ok(!order.isBuilder(T.backup), 'cmd-tools-backup-dev.sh is not a builder');
  assert.ok(!order.isBuilder('cmd-tools-something-project.sh'), 'a tool that ends in -project.sh is still a tool');
  assert.ok(order.isTool(T.clone));
  assert.ok(!order.isTool(B.d11), 'the two kinds do not overlap');
  // The remainder rule: a command shaped like nothing anticipated is still arrangeable.
  assert.ok(order.isTool('cmd-all-front-end-build-themes.sh'));
  assert.ok(!order.isCommand('AGENTS.md'));
});

test('the shipped order: the three bases, then the templates grouped by base', () => {
  clear();
  const all = [B.cmsEducare, B.testing, B.educare, B.vb91x, B.vb11x, B.cms, B.d12, B.d11];
  assert.deepEqual(order.sortBuilders(all, 'dev'), [
    B.d11, B.d12, B.cms, B.vb11x,        // the bases
    B.educare,                            // the site templates on Varbase
    B.cmsEducare,                         // then the same on Drupal CMS, together
    B.testing, B.vb91x,                   // everything unnamed, alphabetical
  ]);
});

test('Drupal CMS itself is a base, not one of its own templates', () => {
  clear();
  // `^cmd-drupalcms2-x-` would swallow cmd-drupalcms2-x-project.sh and put the base last; it is
  // anchored exactly for that reason.
  const got = order.sortBuilders([B.cmsEducare, B.cms, B.d12], 'dev');
  assert.deepEqual(got, [B.d12, B.cms, B.cmsEducare]);
});

test("a workspace's own order comes before the global one, and both before the shipped default", () => {
  write({ global: { builders: [B.vb91x] }, workspaces: { test: { builders: [B.testing] } } });
  const all = [B.d11, B.d12, B.vb91x, B.testing];
  assert.deepEqual(order.sortBuilders(all, 'test'), [B.testing, B.vb91x, B.d11, B.d12],
    'test first, then global, then the shipped order');
  assert.deepEqual(order.sortBuilders(all, 'dev'), [B.vb91x, B.d11, B.d12, B.testing],
    'a workspace that says nothing gets the global order and nothing else');
});

test('builders and tools are separate lists, and saving one leaves the other alone', () => {
  write({ workspaces: { dev: { builders: [B.vb91x], tools: [T.upsun] } } });
  assert.deepEqual(order.sortTools([T.backup, T.clone, T.upsun], 'dev'), [T.upsun, T.backup, T.clone]);
  // Save only the builders back.
  const { raw } = order.rawOrder();
  order.saveOrder(order.withScope(raw, 'dev', { builders: [B.d12] }));
  const after = order.scopeOrder(order.loadOrder().raw, 'dev');
  assert.deepEqual(after.builders, [B.d12]);
  assert.deepEqual(after.tools, [T.upsun], 'the tools it was not given survive the save');
});

test('a mixed list is builders first, then tools', () => {
  clear();
  assert.deepEqual(order.sortCommands([T.backup, B.d12, T.clone, B.d11], 'dev'),
    [B.d11, B.d12, T.backup, T.clone],
    'alphabetical used to drop cmd-tools-backup-dev.sh between two builders');
});

test('minimalOrder writes ONE name for one move, not the whole list', () => {
  clear();
  const shipped = order.sortBuilders([B.d11, B.d12, B.cms, B.vb11x, B.vb91x], 'dev');
  const moved = [B.vb91x, ...shipped.filter((f) => f !== B.vb91x)];
  assert.deepEqual(order.minimalOrder(moved, 'dev'), [B.vb91x],
    'moving one builder to the top shifts every other row, which is why comparing positions got this wrong');
});

test('minimalOrder writes nothing at all when nothing moved', () => {
  clear();
  const shipped = order.sortBuilders([B.d11, B.d12, B.cms, B.vb11x], 'dev');
  assert.deepEqual(order.minimalOrder(shipped, 'dev'), [],
    'a scope that names nothing is what lets a command added later arrive in its shipped place');
});

test('minimalOrder reproduces exactly what was posted, however it was arranged', () => {
  clear();
  const all = [B.d11, B.d12, B.cms, B.vb11x, B.vb91x, B.educare, B.cmsEducare];
  // Reversed is the worst case: nothing is where a default would put it.
  const posted = [...all].reverse();
  const kept = order.minimalOrder(posted, 'dev');
  write({ workspaces: { dev: { builders: kept } } });
  assert.deepEqual(order.sortBuilders(all, 'dev'), posted,
    'what is written must reproduce what was on the screen');
});

test('what is written is filtered and deduplicated, whatever was posted', () => {
  clear();
  const { raw } = order.rawOrder();
  order.saveOrder(order.withScope(raw, 'global', { builders: [B.d12, B.d12, 'cmd-tools-evil.sh', '../../etc/passwd'] }));
  assert.deepEqual(order.scopeOrder(order.loadOrder().raw, 'global').builders, [B.d12],
    'a repeat would give one copy a rank it can never reach; a non-builder is not a builder');
});

test('an empty scope is dropped from the file rather than left as an empty key', () => {
  write({ global: { builders: [B.d12] }, workspaces: { dev: { builders: [B.d11] } } });
  const { raw } = order.rawOrder();
  order.saveOrder(order.withScope(raw, 'dev', { builders: [], tools: [] }));
  const text = fs.readFileSync(process.env.BUILD_ORDER_FILE, 'utf8');
  assert.ok(!/workspaces:/.test(text), 'the last workspace going empty takes the whole key with it');
  assert.ok(/cmd-drupal12/.test(text), 'and the global order is untouched');
});

test('a missing or unreadable file is the shipped order, not an error', () => {
  clear();
  assert.deepEqual(order.sortBuilders([B.d12, B.d11], 'dev'), [B.d11, B.d12]);
  fs.writeFileSync(process.env.BUILD_ORDER_FILE, ':\n  not: [valid\n');
  assert.deepEqual(order.sortBuilders([B.d12, B.d11], 'dev'), [B.d11, B.d12],
    'a broken order file must never cost you the Build form');
  clear();
});
