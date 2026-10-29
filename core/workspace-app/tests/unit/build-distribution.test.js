/**
 * What build_distribution runs, in what order, for a release line that needs more than one composer step.
 *
 * ddev and the helpers around it are stubbed, so the test reads the calls rather than building a site.
 * Varbase 9.1.x-dev could not resolve at all (it asks for varbase_editor 9.2.x-dev, which needs Drupal 11), and
 * a failed drush site:install used to end with "has been installed", over a half-installed site.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTION = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-build-distribution.sh');
const BUILDERS = path.join(__dirname, '..', '..', '..', '..');

// Runs build_distribution with a fake ddev that records its arguments, one call per line.
function build({ declare = '', installFails = false, composerFailsOnce = false, broken = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-'));
  const log = path.join(dir, 'ddev.log');
  fs.mkdirSync(path.join(dir, 'ws'));
  const script = `
WORKSPACE_SCRIPTS=/nowhere; WORKSPACE_ROOT=${dir}; doc_name=ws; PROJECT_NAME=p1; SKIP_DROP_DATABASE=yes; INSTALL=yes; REQUIRE=(_none_); ENABLE=(_none_)
distribution_name=stub; distribution_webroot=docroot; distribution_project_template=drupal/stub; site_version=1.0.x-dev
${declare}
ddev() { printf '%s\\n' "$*" >> ${log}; if [ "${composerFailsOnce ? 'yes' : 'no'}" = yes ] && [ "$1 $2" = 'composer install' ] && [ ! -e ${dir}/failed-once ]; then touch ${dir}/failed-once; return 1; fi; if [ "$1 $2" = 'drush status' ]; then echo ${broken ? 'Failed' : 'Successful'}; fi; if [ "$1" = config ]; then mkdir -p .ddev; printf 'docroot: docroot\\ndatabase:\\n  version: "11.8"\\n' > .ddev/config.yaml; fi; return 0; }
ddev_up() { :; }; set_default_settings() { :; }; add_drush() { :; }; drush_set_debug_on() { :; }; drush_cr() { :; }; add_users() { :; }
source ${FUNCTION}
source() { if [ "$1" = "\${WORKSPACE_SCRIPTS}/functions/fun-distribution-stub.sh" ]; then
  install_stub_with_drush() { ${installFails ? 'return 1' : 'ddev drush site:install stub'}; }; enable_stub_extra_components() { :; }
  else builtin source "$@"; fi; }
build_distribution; echo "exit=$?"
`;
  const run = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { calls, out: run.stdout, code: Number((run.stdout.match(/exit=(\d+)/) || [])[1]) };
}

const index = (calls, needle) => calls.findIndex((c) => c.includes(needle));

test('a builder that declares nothing creates the project in one step, as before', () => {
  const { calls, code } = build();
  assert.strictEqual(code, 0);
  const create = calls.find((c) => c.startsWith('composer create-project'));
  assert.ok(create && !create.includes('--no-install'), create);
  assert.ok(index(calls, 'composer require') < 0 && index(calls, 'composer install') < 0 && index(calls, 'patches-ignore') < 0);
});

test('declared requirements and patches to ignore are applied between create-project and the first install', () => {
  const { calls, code } = build({
    declare: `site_composer_requires=("drupal/varbase_editor:9.2.13 as 9.2.x-dev"); site_patches_ignore=("drupal/pp https://x.test/a.patch" "drupal/qq https://x.test/b.patch")`,
  });
  assert.strictEqual(code, 0);
  const create = index(calls, 'composer create-project');
  assert.ok(calls[create].includes('--no-install') && calls[create].includes('--no-scripts'), calls[create]);
  const order = ['composer create-project', 'composer require', 'composer config', 'composer install', 'composer run-script post-create-project-cmd', 'drush site:install']
    .map((n) => index(calls, n));
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), `in order: ${calls.join(' | ')}`);
  assert.ok(order.every((i) => i >= 0));
  assert.match(calls[index(calls, 'composer require')], /^composer require drupal\/varbase_editor:9\.2\.13 as 9\.2\.x-dev --no-update/);
  const config = calls[index(calls, 'composer config')];
  assert.strictEqual(config, 'composer config --json extra.patches-ignore {"vardot/varbase-patches": {"drupal/pp": ["https://x.test/a.patch"], "drupal/qq": ["https://x.test/b.patch"]}}');
});

test('a failed drush site:install stops the build instead of reporting the site as installed', () => {
  const { out, code, calls } = build({ installFails: true });
  assert.strictEqual(code, 1);
  assert.match(out, /install of ws p1 failed/);
  assert.ok(!/has been installed/.test(out), out);
  assert.ok(index(calls, 'drush') < 0, 'nothing runs after a failed install');
});

test('the Varbase lines that cannot resolve on their own declare what they need', () => {
  const read = (f) => fs.readFileSync(path.join(BUILDERS, 'dev', f), 'utf8');
  const nine1 = read('cmd-varbase9-1-x-project.sh');
  assert.match(nine1, /site_composer_requires=\("drupal\/varbase_editor:9\.2\.13 as 9\.2\.x-dev"\)/);
  assert.match(nine1, /site_patches_ignore=\("drupal\/paragraphs_previewer https:\/\/[^ "]*paragraphs_previewer--2025-12-08--3538671--mr-5\.patch"\)/);
  assert.match(read('cmd-varbase9-2-x-project.sh'), /site_patches_ignore=\("drupal\/paragraphs_previewer /);
  assert.ok(!/site_composer_requires/.test(read('cmd-varbase9-2-x-project.sh')));
  const ten0 = read('cmd-varbase10-0-x-project.sh');
  assert.match(ten0, /site_composer_requires=\("drupal\/varbase_ai:2\.0\.7 as 2\.0\.x-dev" "drupal\/drimage_improved:1\.0\.11"\)/);
  assert.match(ten0, /site_install_args=\("varbase_extra_components\.varbase_demo=NULL" "varbase_extra_components\.varbase_api=true"\)/, 'a checkbox is off only when it is NULL');
  assert.match(read('cmd-varbase10-0-0-project.sh'), /site_install_args=\("varbase_extra_components\.varbase_demo=NULL" "varbase_extra_components\.varbase_api=true"\)/, 'the release has the same install problems');
  for (const f of ['cmd-varbase10-1-x-project.sh', 'cmd-varbase11-0-x-project.sh']) assert.match(read(f), /site_patches_ignore=\("drupal\/tagify https:\/\/[^ "]*tagify--2026-07-28--3555084--mr-177\.patch"\)/, f);
});

test('each Varbase line is built into the docroot its template uses: web for 11.0, docroot for the rest', () => {
  const webroot = (f) => (fs.readFileSync(path.join(BUILDERS, 'dev', f), 'utf8').match(/^distribution_webroot="([^"]+)"/m) || [])[1];
  for (const line of ['9-1-0', '9-1-x', '9-2-0', '9-2-x', '10-0-0', '10-0-x', '10-1-0', '10-1-x']) assert.strictEqual(webroot(`cmd-varbase${line}-project.sh`), 'docroot', line);
  for (const line of ['11-0-0', '11-0-x']) assert.strictEqual(webroot(`cmd-varbase${line}-project.sh`), 'web', line);
});

test('the first composer install is tried once more, because it can fail on a git cache hiccup and pass at once', () => {
  const declare = 'site_patches_ignore=("drupal/pp https://x.test/a.patch")';
  const { calls, code } = build({ declare, composerFailsOnce: true });
  assert.strictEqual(code, 0);
  assert.strictEqual(calls.filter((c) => c === 'composer install --no-interaction').length, 2);
  assert.ok(index(calls, 'drush site:install') > 0, 'and the build carries on to the install');
});

test('drush is waited for, since DDEV rewrites its shared command directory whenever any project starts', () => {
  const DRUSH = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-drush.sh');
  const run = (failures) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-drush-'));
    const script = `
n=0; mkdir -p ${dir}/ws/p/vendor/drush/drush; WORKSPACE_ROOT=${dir}; doc_name=ws; PROJECT_NAME=p
ddev() { if [ "$1 $2" = 'drush --version' ]; then n=$((n+1)); [ $n -gt ${failures} ]; return; fi; }
sleep() { :; }
source ${DRUSH}; add_drush; echo "exit=$? tries=$n"
`;
    return spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout;
  };
  assert.match(run(0), /exit=0 tries=1/);
  assert.match(run(2), /exit=0 tries=3/, 'two misses, then it is there');
  assert.match(run(99), /still not available[\s\S]*exit=1 tries=10/, 'but not for ever');
});

test('a site that installed but no longer bootstraps fails the build instead of being announced as installed', () => {
  const ok = build();
  assert.strictEqual(ok.code, 0);
  const bad = build({ broken: true });
  assert.strictEqual(bad.code, 1);
  assert.match(bad.out, /does not bootstrap/);
  assert.ok(!/has been installed/.test(bad.out), bad.out);
});
