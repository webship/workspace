/**
 * The checks resolver: what a package declares, and which of it is safe to run.
 *
 * This is the one place the alias map lives — the shell verb shells out to it and the dashboard
 * requires it — so it is the one place worth testing hard. Every case here is a real shape found in
 * this workspace, named in the comment, because a rule invented for a package that does not exist is
 * a rule nobody can check.
 *
 * Fixtures are written to a temp directory: the resolver reads package.json, the lockfiles and
 * node_modules from disk, and stubbing fs would test the stub.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Reached through WORKSPACE_ROOT rather than by counting ../ : the dashboard is bind-mounted at
// /var/www/html inside its container, where a relative path out of the app leaves the mount
// altogether. The app itself resolves the resolver the same way, in checks.js.
const { ROOT } = require('../../workspaces');
const {
  resolvePlan, resolveRunner, resolveDeps, MASK, DENY_COMMAND, E2E_OK,
} = require(path.join(ROOT, 'core', 'scripts', 'libs', 'checks_plan'));

// A package on disk. `installed` fakes node_modules/.bin, which is what "runnable" means.
function pkg(scripts, { installed = true, lock = 'yarn.lock', packageManager = null, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-checks-'));
  const json = { name: 'fixture', scripts };
  if (packageManager) json.packageManager = packageManager;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
  if (lock) fs.writeFileSync(path.join(dir, lock), '');
  if (installed) fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  for (const [rel, body] of Object.entries(extra)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const row = (plan, id) => plan.rows.find((r) => r.id === id);

test('a package is read in its own vocabulary, whatever it calls things', () => {
  // themes/vartheme_bs5 and 21 products carry exactly this set.
  const plan = resolvePlan(pkg({
    'lint:js': 'eslint .', 'lint:css': 'stylelint "**/*.css"', 'lint:yaml': 'eslint --ext .yml .',
    spellcheck: 'cspell lint .',
  }));
  assert.equal(row(plan, 'js').status, 'ready');
  assert.equal(row(plan, 'js').script, 'lint:js');
  assert.equal(row(plan, 'css').status, 'ready');
  assert.equal(row(plan, 'yaml').status, 'ready');
  assert.equal(row(plan, 'spelling').script, 'spellcheck');
  // And says plainly what it does not cover.
  assert.equal(row(plan, 'types').status, 'none');
  assert.equal(row(plan, 'types').reason, 'not declared');
});

test('a package that spells them differently resolves to the same checks', () => {
  // modules/canvas: lint:eslint / lint:stylelint / lint:cspell / lint:tsc / lint:prettier.
  const plan = resolvePlan(pkg({
    'lint:eslint': 'eslint src', 'lint:stylelint': 'stylelint "src/**/*.css"',
    'lint:cspell': 'cspell .', 'lint:tsc': 'tsc --noEmit', 'lint:prettier': 'prettier --check .',
  }));
  for (const id of ['js', 'css', 'spelling', 'types', 'format']) {
    assert.equal(row(plan, id).status, 'ready', `${id} should resolve`);
  }
});

test('an aggregate does not run beside the parts it fans out to', () => {
  // modules/canvas declares `lint` (concurrently) AND every part. Running both is double the work.
  const plan = resolvePlan(pkg({ lint: 'concurrently "yarn lint:js" "yarn lint:css"', 'lint:js': 'eslint .', 'lint:css': 'stylelint "*.css"' }));
  assert.ok(!plan.rows.some((r) => r.id === 'lint'), 'the aggregate row is dropped');
  assert.equal(row(plan, 'js').status, 'ready');
});

test('an aggregate IS used when a package declares nothing else', () => {
  const plan = resolvePlan(pkg({ lint: 'eslint . && stylelint "*.css"' }));
  const agg = plan.rows.find((r) => r.id === 'lint');
  assert.ok(agg, 'the aggregate row is emitted');
  assert.equal(agg.status, 'ready');
});

test('a masked script fails the run rather than passing quietly', () => {
  // modules/commerce_cart_flyout masks three of its lint scripts exactly like this.
  const plan = resolvePlan(pkg({ 'lint:css': 'stylelint "**/*.css" || exit 0' }));
  assert.equal(row(plan, 'css').status, 'masked');
  assert.match(row(plan, 'css').reason, /would be a lie/);
  assert.ok(MASK.test('foo || true'), 'and || true is the same lie');
});

test('a script that writes is refused, however it is named', () => {
  // modules/gin_lb calls its writer `lint-all`; themes/vartheme_bs5 ends theme:build with --fix.
  const byName = resolvePlan(pkg({ 'lint:js': 'eslint "src/**/*.js" --fix' }));
  assert.equal(row(byName, 'js').status, 'refused');
  assert.match(row(byName, 'js').reason, /--fix/);
  assert.ok(DENY_COMMAND.test('prettier --write .'));
  assert.ok(DENY_COMMAND.test('nodemon server.js'));
  assert.ok(DENY_COMMAND.test('lint-staged'));
});

test('a stylelint call that names no files is refused, because it checks nothing', () => {
  // 21 of the 45 lint:css declarations in this tree are this shape.
  const plan = resolvePlan(pkg({ 'lint:css': 'stylelint --config=.stylelintrc.json' }));
  assert.equal(row(plan, 'css').status, 'refused');
  assert.match(row(plan, 'css').reason, /names no files/);
  // With a glob it is fine.
  assert.equal(row(resolvePlan(pkg({ 'lint:css': 'stylelint --config=.stylelintrc.json "**/*.css"' })), 'css').status, 'ready');
});

test('the browser suite is off unless asked for, and never on a package', () => {
  const scripts = { 'test:chromium': 'BROWSER=chromium cucumber-js --config cucumber.js' };
  const off = resolvePlan(pkg(scripts));
  assert.equal(off.rows.find((r) => r.id === 'e2e').status, 'none');
  assert.match(off.rows.find((r) => r.id === 'e2e').reason, /add --e2e/);

  const onPackage = resolvePlan(pkg(scripts), { e2e: true });
  assert.equal(row(onPackage, 'e2e').status, 'refused');
  assert.match(row(onPackage, 'e2e').reason, /no site to test against/);

  const onSite = resolvePlan(pkg(scripts, { extra: { '.ddev/config.yaml': 'name: x\n' } }), { e2e: true });
  assert.equal(row(onSite, 'e2e').status, 'ready');
});

test('a test script that is not a browser suite is not treated as one', () => {
  // products/bootstrap_styles: `test` is a build. Running it as a suite would be wrong twice over.
  const plan = resolvePlan(pkg({ test: 'npm run build && node scripts/check.js' }), { e2e: true });
  assert.equal(row(plan, 'e2e').status, 'none');
  assert.ok(E2E_OK.test('cucumber-js --config cucumber.js'));
  assert.ok(E2E_OK.test('playwright test'));
  assert.ok(!E2E_OK.test('jest'));
});

test('phpcs is skipped, never reported green, when the binary is not there', () => {
  // 76 packages declare phpcs; the binary is a composer one and lives in a site, not in node_modules.
  const without = resolvePlan(pkg({ phpcs: 'phpcs --standard=./.phpcs.xml .' }));
  assert.equal(row(without, 'php').status, 'skipped');
  assert.match(row(without, 'php').reason, /no vendor\/bin\/phpcs/);

  const with_ = resolvePlan(pkg({ phpcs: 'phpcs .' }, { extra: { 'vendor/bin/phpcs': '#!/bin/sh\n' } }));
  assert.equal(row(with_, 'php').status, 'ready');
});

test('a site carrying the ddev-dev-tools add-on gets php and twig from it', () => {
  const dir = pkg({}, { extra: {
    '.ddev/config.yaml': 'name: x\n',
    '.ddev/commands/web/dev-phpcs': '#!/bin/bash\n',
  } });
  const plan = resolvePlan(dir);
  assert.equal(row(plan, 'php').status, 'ready');
  assert.equal(row(plan, 'php').command, 'ddev dev-phpcs --all');
  assert.equal(row(plan, 'twig').command, 'ddev dev-twigcs --all');
});

test('the package manager is chosen from what the package says, and says why', () => {
  assert.deepEqual(resolveRunner(pkg({}, { lock: 'yarn.lock' })), { runner: 'yarn', reason: 'yarn.lock' });
  assert.deepEqual(resolveRunner(pkg({}, { lock: 'package-lock.json' })), { runner: 'npm', reason: 'package-lock.json' });
  const berry = resolveRunner(pkg({}, { lock: null, packageManager: 'yarn@4.9.3' }));
  assert.equal(berry.runner, 'yarn');
  assert.match(berry.reason, /yarn@4\.9\.3/);
  const none = resolveRunner(pkg({}, { lock: null }));
  assert.equal(none.runner, null);
  assert.match(none.reason, /pass --runner/);
});

test('a stale .pnp.cjs is not an installed package', () => {
  // products/varbase_core: a PnP file left over beside a .yarnrc.yml that now asks for node-modules.
  // Believing it made every check fail with "Couldn't find the node_modules state file".
  const stale = pkg({ 'lint:yaml': 'eslint --ext .yml .' }, {
    installed: false, extra: { '.pnp.cjs': '// old', '.yarnrc.yml': 'nodeLinker: node-modules\n' },
  });
  assert.equal(resolveDeps(stale).installed, false);
  assert.match(resolveDeps(stale).evidence, /stale/);
  assert.equal(row(resolvePlan(stale), 'yaml').status, 'deps-missing');

  // Real PnP, with no nodeLinker override, is runnable and has no node_modules at all.
  const pnp = pkg({}, { installed: false, extra: { '.pnp.cjs': '// real' } });
  assert.equal(resolveDeps(pnp).installed, true);
});

test('--only and --skip narrow the run without hiding what exists', () => {
  const scripts = { 'lint:js': 'eslint .', 'lint:css': 'stylelint "*.css"', 'lint:yaml': 'eslint --ext .yml .' };
  const only = resolvePlan(pkg(scripts), { only: 'js' });
  assert.equal(row(only, 'js').status, 'ready');
  assert.equal(row(only, 'css').status, 'none');
  assert.match(row(only, 'css').reason, /not in --only/);

  const skip = resolvePlan(pkg(scripts), { skip: 'css' });
  assert.equal(row(skip, 'js').status, 'ready');
  assert.equal(row(skip, 'css').status, 'skipped');
});

test('every row is always reported, so a gap is visible rather than absent', () => {
  const plan = resolvePlan(pkg({ 'lint:js': 'eslint .' }));
  assert.deepEqual(plan.rows.map((r) => r.id),
    ['format', 'js', 'css', 'yaml', 'spelling', 'types', 'php', 'twig', 'e2e']);
});

test('a directory with no package.json is not an error, it is a package with nothing to run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-checks-'));
  const plan = resolvePlan(dir);
  assert.equal(plan.hasPackageJson, false);
  assert.ok(plan.rows.every((r) => r.status === 'none'));
});
