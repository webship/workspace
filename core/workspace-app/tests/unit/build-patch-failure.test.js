/**
 * A build stops when a patch fails, and a second composer install counts only when it installs (webship/workspace#540).
 *
 * composer-patches fails a run after the package is on disk, unpatched. The builders tried `composer install` once
 * more (for the git cache hiccup that passes on a second try), that install had nothing to do, and the build went on
 * to install a site that was missing a patch. A fake ddev answers each composer step with the output given here.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTION = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-build-distribution.sh');

const PATCH_FAILED = [
  '  - Installing drupal/stub_module (1.2.0): Extracting archive',
  '  - Applying patches for drupal/stub_module',
  '',
  'In Patches.php line 331:',
  '',
  '  No available patcher was able to apply patch https://www.drupal.org/files/issues/2026-11-01/stub-fix-3',
  '  500001-12.patch to drupal/stub_module',
  '',
].join('\n');
const NOTHING = 'Installing dependencies from lock file (including require-dev)\nNothing to install, update or remove\nGenerating autoload files';
const INSTALLED = 'Installing dependencies from lock file (including require-dev)\n  - Installing drupal/core (11.4.0): Extracting archive\nGenerating autoload files';
const HICCUP = 'Failed to execute git checkout "0f1e2d3c" -- && git reset --hard "0f1e2d3c" --\nfatal: reference is not a tree: 0f1e2d3c';

/**
 * composer_create_project with `steps`: one { out, code } per composer install or create-project call, in order.
 * `twoStep` declares a patch to ignore, which makes the builder create the project with --no-install first.
 */
function create(steps, { twoStep = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-patchfail-'));
  steps.forEach((s, i) => {
    fs.writeFileSync(path.join(dir, `step-${i + 1}.out`), s.out);
    fs.writeFileSync(path.join(dir, `step-${i + 1}.code`), String(s.code));
  });
  // The project reached the install step: composer.json is in place.
  fs.writeFileSync(path.join(dir, 'composer.json'), '{}');
  const script = `
cd ${dir}
${twoStep ? 'site_patches_ignore=("drupal/stub_module https://example.org/a.patch")' : 'site_patches_ignore=()'}
site_composer_requires=()
ddev() {
  printf '%s\\n' "$*" >> ${dir}/calls.log
  if [ "$1" = composer ] && { [ "$2" = install ] || { [ "$2" = create-project ] && [ "${twoStep ? 'yes' : 'no'}" = no ]; }; }; then
    i=$(( $(cat ${dir}/n 2>/dev/null || echo 0) + 1 )); echo $i > ${dir}/n
    cat ${dir}/step-$i.out 2>/dev/null; return $(cat ${dir}/step-$i.code 2>/dev/null || echo 0)
  fi
  return 0
}
source ${FUNCTION}
composer_create_project drupal/stub_project:1.0.x-dev
echo "exit=$?"`;
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const calls = fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { out: run.stdout, err: run.stderr, calls, code: Number((run.stdout.match(/exit=(\d+)/) || [])[1]) };
}

const installs = (calls) => calls.filter((c) => c.startsWith('composer install')).length;

test('create-project that fails on a patch stops the build, names the patch and installs nothing more', () => {
  const r = create([{ out: PATCH_FAILED, code: 1 }]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /A patch did not apply, so composer stopped with the package on disk but not patched:/);
  assert.match(r.out, /^ {2}No available patcher was able to apply patch https:\/\/www\.drupal\.org\/files\/issues\/2026-11-01\/stub-fix-3$/m);
  assert.match(r.out, /^ {2}500001-12\.patch to drupal\/stub_module$/m, 'the wrapped line is shown too');
  assert.match(r.out, /site_patches_ignore/);
  assert.strictEqual(installs(r.calls), 0, r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => c.includes('post-create-project-cmd')), 'nothing runs after it');
});

test('create-project that fails on a git hiccup, then installs on the second try, still builds', () => {
  const r = create([{ out: HICCUP, code: 1 }, { out: INSTALLED, code: 0 }]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /composer create-project needed a second install, which worked\./);
  assert.strictEqual(installs(r.calls), 1);
});

test('a second install that has nothing to install is no success: the build stops and points at the first error', () => {
  const r = create([{ out: HICCUP, code: 1 }, { out: NOTHING, code: 0 }]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /The second composer install had nothing to install, so it did not run again what failed the first time\./);
  assert.doesNotMatch(r.out, /needed a second install, which worked/);
});

test('with a patch to ignore declared, a failed patch in the install stops the build without a second install', () => {
  const r = create([{ out: PATCH_FAILED, code: 1 }], { twoStep: true });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /A patch did not apply/);
  assert.strictEqual(installs(r.calls), 1, r.calls.join('\n'));
  assert.match(r.out, /composer could not install drupal\/stub_project:1\.0\.x-dev\./);
});

test('with a patch to ignore declared, a git hiccup gets its second install, which builds when it installs', () => {
  const r = create([{ out: HICCUP, code: 1 }, { out: INSTALLED, code: 0 }], { twoStep: true });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(installs(r.calls), 2);
});

test('a checksum mismatch on a downloaded patch counts as a failed patch', () => {
  const r = create([{ out: 'Hash mismatch for patch downloaded from https://example.org/b.patch', code: 1 }]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /A patch did not apply/);
  assert.strictEqual(installs(r.calls), 0);
});
