/**
 * Cutting a release: the version is stamped BEFORE the tag.
 *
 * `core/workspace-app/.app-version` is what the dashboard reads to say which release a machine runs and
 * which notes to link to. Nothing in the hand-rolled release wrote it, so the machine that cut a release
 * went on reporting the one before it — a number in the rail that is wrong and links to the wrong notes,
 * which is worse than no number at all because it stops the question being asked.
 *
 * So the order is the feature: stamp, then tag. If the stamp fails nothing is published and the tree is
 * still honestly on the old release. If the tag went first and the stamp failed, the release would exist
 * with every machine reporting the old one — exactly the state this prevents.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', 'scripts');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fun = read('functions/fun-release.sh');
const script = read('release.sh');
const args = read('args/arg-release.sh');

/** Run one function of the library, so these test what the shell actually does. */
function sh(line) {
  return execFileSync('bash', ['-c', `source ${path.join(ROOT, 'functions', 'fun-release.sh')} >/dev/null 2>&1; ${line}`],
    { encoding: 'utf8' }).trim();
}

test('the next tag is the last segment, plus one', () => {
  assert.strictEqual(sh('release_next_tag 1.0.13'), '1.0.14');
  assert.strictEqual(sh('release_next_tag 1.0.9'), '1.0.10');
  assert.strictEqual(sh('release_next_tag 1.9.99'), '1.9.100');
  assert.strictEqual(sh('release_next_tag 2.0.0'), '2.0.1');
});

test('a tag shape it cannot read is refused, never guessed at', () => {
  // A tag is permanent and a wrong one cannot be taken back.
  for (const bad of ['', 'v1.0.13', '1.0.13-rc1', 'latest', '1']) {
    assert.strictEqual(sh(`release_next_tag '${bad}' || true`), '', `refused: ${JSON.stringify(bad)}`);
  }
});

test('the stamp is written before the tag', () => {
  const stamp = fun.indexOf('workspace_version_stamp');
  const tag = fun.indexOf('git -C "${clone}" tag -a');
  assert.ok(stamp > 0 && tag > 0, 'it does both');
  assert.ok(stamp < tag, 'and the stamp comes first — the order IS the fix');
  assert.match(fun, /nothing was tagged/, 'and a stamp that fails publishes nothing');
});

test('it is confirm-gated: a tag and a release page are public and permanent', () => {
  assert.match(script, /if \[ "\$\{CONFIRM\}" != 'yes' \]; then/);
  assert.match(script, /Nothing was created\. Add --confirm/);
  assert.match(args, /Actually cut it\. Without this the plan is printed and nothing is created\./);
});

test('a released tag is never moved', () => {
  assert.match(script, /already exists\. A released tag is never moved\./);
  assert.match(script, /rev-parse -q --verify "refs\/tags\/\$\{NEXT\}"/);
});

test('it refuses a clone that is not releasable, and says which part', () => {
  for (const reason of ['is on', 'uncommitted changes', 'ahead /']) {
    assert.ok(fun.includes(reason), `it says: ${reason}`);
  }
  assert.match(script, /Refusing to release: the checks above did not pass\./);
  assert.match(script, /Releases are cut from the git checkout, not from the live tree\./);
});

test('the gate is the smoke test and the dashboard unit tests', () => {
  assert.match(fun, /cmd-smoke-test\.sh/);
  assert.match(fun, /npm run --silent test:unit/);
  assert.match(fun, /dashboard unit tests skipped \(no node_modules in the live tree\)/,
    'a machine without them is told, not silently passed');
});

test('the repository comes from settings.yml, so a fork releases itself', () => {
  assert.match(fun, /sources_tooling_repo/);
  assert.match(fun, /No sources\.tooling\.repo in settings\.yml/);
});

test('the argparse flags are all declared, and the store_true ones read as yes', () => {
  for (const flag of ['--tag', '--branch', '--notes', '--no-gate', '--confirm']) {
    assert.ok(args.includes(`'${flag}'`), `${flag} is declared`);
  }
  // argparse-bash sets a store_true dest to 'yes', not 'true' — testing for 'true' made --no-gate
  // run the gate anyway, which is a flag that silently does nothing.
  assert.ok(!script.includes("!= 'true'"), 'no flag is compared against true');
});
