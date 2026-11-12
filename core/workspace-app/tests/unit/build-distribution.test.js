/**
 * What build_distribution runs, in what order, for a release line that needs more than one composer step.
 *
 * ddev and the helpers around it are stubbed, so the test reads the calls rather than building a site.
 * A line that cannot resolve on its own declares what it needs (an alias, a patch to ignore), and
 * a failed drush site:install used to end with "has been installed", over a half-installed site.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTION = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-build-distribution.sh');
const NODEJS = path.join(__dirname, '..', '..', '..', 'scripts', 'functions', 'fun-ddev-nodejs.sh');

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
source ${FUNCTION}; source ${NODEJS}
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

test('every ddev config of a build pins Node.js 24, and the first one still gets its PHP version and --auto', () => {
  const { calls, code } = build({ declare: 'site_php_version=8.5' });
  assert.strictEqual(code, 0);
  const configs = calls.filter((c) => c.startsWith('config '));
  assert.strictEqual(configs.length, 2, configs.join('\n'));
  for (const c of configs) assert.ok(c.includes('--nodejs-version=24'), c);
  // #767 put ddev_telemetry_off inside this call's line continuation, so --php-version and --auto ran as a command.
  assert.ok(configs[0].includes('--php-version=8.5') && configs[0].endsWith('--auto'), configs[0]);
  assert.ok(!configs[0].includes('ddev_telemetry_off'), configs[0]);
});

test('the PHP version of the build is set again after create-project, where the template brings its own DDEV config', () => {
  // The template's .ddev/config.yaml replaces the builder's: composer resolved on 8.4, the project ran the
  // template's 8.3, and drush site:install stopped on "Your Composer dependencies require a PHP version".
  for (const declare of ['PHP_VERSION=8.4', 'site_php_version=8.4', 'PHP_VERSION=8.4; site_php_version=8.5']) {
    const { calls, code } = build({ declare });
    assert.strictEqual(code, 0);
    const configs = calls.filter((c) => c.startsWith('config '));
    assert.strictEqual(configs.length, 2, configs.join('\n'));
    for (const c of configs) assert.ok(c.includes('--php-version=8.4'), `${declare}: ${c}`);
    assert.ok(index(calls, 'composer create-project') < calls.indexOf(configs[1]), 'the second one follows create-project');
    assert.ok(configs[1].includes('--database=mariadb:11.8') && configs[1].includes('--nodejs-version=24'), configs[1]);
  }
  // Nobody asked for a version: DDEV's default before, the template's own after, as it was.
  const plain = build();
  for (const c of plain.calls.filter((x) => x.startsWith('config '))) assert.ok(!c.includes('--php-version'), c);
});

test('the Webships builder sets its PHP version again after create-project too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-webships-'));
  const log = path.join(dir, 'ddev.log');
  fs.mkdirSync(path.join(dir, 'ws'));
  const WEBSHIPS = path.join(path.dirname(FUNCTION), 'fun-build-webships.sh');
  const run = (declare) => {
    fs.rmSync(log, { force: true });
    const script = `
WORKSPACE_ROOT=${dir}; doc_name=ws; PROJECT_NAME=p1; distribution_webroot=web; ${declare}
ddev() { printf '%s\\n' "$*" >> ${log}; return 0; }
drop_database() { :; }
source ${NODEJS}; source ${WEBSHIPS}
webships_create_project drupal/stub:1.0.x-dev; echo "exit=$?"
`;
    const out = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' }).stdout;
    assert.match(out, /exit=0/);
    return fs.readFileSync(log, 'utf8').trim().split('\n');
  };
  for (const [declare, version] of [['PHP_VERSION=8.5', '8.5'], ['', '8.4']]) {
    const calls = run(declare);
    const configs = calls.filter((c) => c.startsWith('config '));
    assert.strictEqual(configs.length, 2, configs.join('\n'));
    for (const c of configs) assert.ok(c.includes(`--php-version=${version}`) && c.includes('--nodejs-version=24'), c);
    assert.ok(index(calls, 'composer create-project') < calls.indexOf(configs[1]));
  }
});

test('a builder that declares site_nodejs_version gets that version instead', () => {
  const { calls } = build({ declare: 'site_nodejs_version=22' });
  const configs = calls.filter((c) => c.startsWith('config '));
  for (const c of configs) assert.ok(c.includes('--nodejs-version=22') && !c.includes('--nodejs-version=24'), c);
});

test('declared requirements and patches to ignore are applied between create-project and the first install', () => {
  const { calls, code } = build({
    declare: `site_composer_requires=("drupal/stub_editor:1.2.3 as 1.2.x-dev"); site_patches_ignore=("drupal/pp https://x.test/a.patch" "drupal/qq https://x.test/b.patch")`,
  });
  assert.strictEqual(code, 0);
  const create = index(calls, 'composer create-project');
  assert.ok(calls[create].includes('--no-install') && calls[create].includes('--no-scripts'), calls[create]);
  const order = ['composer create-project', 'composer require', 'composer config', 'composer install', 'composer run-script post-create-project-cmd', 'drush site:install']
    .map((n) => index(calls, n));
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), `in order: ${calls.join(' | ')}`);
  assert.ok(order.every((i) => i >= 0));
  assert.match(calls[index(calls, 'composer require')], /^composer require drupal\/stub_editor:1\.2\.3 as 1\.2\.x-dev --no-update/);
  // The ignore list is keyed on the patches package the distributions share, webship/patches.
  const config = calls[index(calls, 'composer config')];
  assert.strictEqual(config, 'composer config --json extra.patches-ignore {"webship/patches": {"drupal/pp": ["https://x.test/a.patch"], "drupal/qq": ["https://x.test/b.patch"]}}');
});

test('a failed drush site:install stops the build instead of reporting the site as installed', () => {
  const { out, code, calls } = build({ installFails: true });
  assert.strictEqual(code, 1);
  assert.match(out, /install of ws p1 failed/);
  assert.ok(!/has been installed/.test(out), out);
  assert.ok(index(calls, 'drush') < 0, 'nothing runs after a failed install');
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
