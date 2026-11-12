/**
 * What the Website builders run, in what order.
 *
 * ddev and the helpers around it are stubbed, so the test reads the calls rather than building a site.
 * build_website_project (drupal/website, installed by the Webship installer) had no way to add a root
 * requirement or to ignore a patch before the first install, the way build_distribution has.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FUNCTIONS = path.join(__dirname, '..', '..', '..', 'scripts', 'functions');

// Runs a Website build function with a fake ddev that records its arguments, one call per line.
function build({ declare = '', run = 'build_website_project' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-website-'));
  const log = path.join(dir, 'ddev.log');
  fs.mkdirSync(path.join(dir, 'ws'));
  const script = `
WORKSPACE_ROOT=${dir}; doc_name=ws; PROJECT_NAME=p1
distribution_name=website; distribution_title=Website; distribution_webroot=web; distribution_project_template=drupal/website; site_version=12.0.x-dev
account_name=admin; account_pass=pass; account_mail=admin@example.com
${declare}
ddev() { printf '%s\\n' "$*" >> ${log}; return 0; }
drop_database() { :; }; set_default_settings() { :; }; drush_set_debug_on() { :; }; drush_cr() { :; }; add_users() { :; }
source ${FUNCTIONS}/fun-build-distribution.sh; source ${FUNCTIONS}/fun-ddev-nodejs.sh; source ${FUNCTIONS}/fun-build-website.sh
${run}; echo "exit=$?"
`;
  const res = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { calls, out: res.stdout, code: Number((res.stdout.match(/exit=(\d+)/) || [])[1]) };
}

const index = (calls, needle) => calls.findIndex((c) => c.includes(needle));

test('a Website builder that declares nothing creates the project in one step and installs with the chosen template', () => {
  const { calls, code } = build({ declare: 'TEMPLATE=webship_portal' });
  assert.strictEqual(code, 0);
  const create = calls.find((c) => c.startsWith('composer create-project'));
  assert.strictEqual(create, 'composer create-project drupal/website:12.0.x-dev . --no-interaction');
  assert.ok(index(calls, 'patches-ignore') < 0 && index(calls, 'composer install') < 0);
  const install = calls.find((c) => c.startsWith('drush site:install'));
  assert.ok(install.includes('site:install webship') && install.includes('installer_site_template_form.add_ons=webship_portal'), install);
});

test('declared requirements and patches to ignore are applied between create-project and the first install', () => {
  const { calls, code } = build({
    declare: `site_composer_requires=("drupal/stub:1.2.3 as 1.2.x-dev"); site_patches_ignore=("drupal/pp https://x.test/a.patch")`,
  });
  assert.strictEqual(code, 0);
  const create = index(calls, 'composer create-project');
  assert.ok(calls[create].includes('--no-install') && calls[create].includes('--no-scripts'), calls[create]);
  const order = ['composer create-project', 'composer require drupal/stub', 'composer config --json extra.patches-ignore', 'composer install', 'composer run-script post-create-project-cmd', 'drush site:install']
    .map((n) => index(calls, n));
  assert.ok(order.every((i) => i >= 0), calls.join(' | '));
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b), `in order: ${calls.join(' | ')}`);
  assert.strictEqual(calls[order[2]], 'composer config --json extra.patches-ignore {"webship/patches": {"drupal/pp": ["https://x.test/a.patch"]}}');
});

test('a site template build on the recommended project takes the same declarations', () => {
  const { calls, code } = build({
    declare: `site_template_name=website_starter; site_template_title="Website Starter"; site_template_package=drupal/website_starter; site_version=1.0.x-dev; site_patches_ignore=("drupal/pp https://x.test/a.patch")`,
    run: 'build_website_site_template',
  });
  assert.strictEqual(code, 0);
  const create = calls.find((c) => c.startsWith('composer create-project'));
  assert.ok(create.startsWith('composer create-project drupal/recommended-project:') && create.includes('--no-install'), create);
  assert.ok(index(calls, 'extra.patches-ignore') > 0);
});
