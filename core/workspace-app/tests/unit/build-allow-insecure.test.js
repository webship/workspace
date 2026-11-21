/**
 * --allow-insecure on the builders (webship/workspace#569).
 *
 * Composer 2.9 and later refuse to install a package with a published security advisory, which can stop a test build of
 * an older release line. A builder asked for --allow-insecure passes composer's --no-security-blocking to every composer
 * call of the build and warns once; without the flag nothing changes.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const FUNCTIONS = ['fun-build-distribution.sh', 'fun-build-site-template.sh', 'fun-build-webships.sh', 'fun-build-website.sh', 'fun-drush.sh'];
// The site-template builders install a published template and take almost no flags on purpose (builder-args tests):
// they are not offered the option.
const ARGS = ['arg-drupal.sh', 'arg-drupal_cms.sh', 'arg-webship.sh', 'arg-webships-project.sh', 'arg-webships.sh', 'arg-website.sh'];

test('every composer call of the build functions carries the option', () => {
  const missing = [];
  for (const f of FUNCTIONS) {
    fs.readFileSync(path.join(SCRIPTS, 'functions', f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line) || /\becho\b/.test(line)) return;
      if (/(ddev composer|composer_logged) (create-project|require|install|update)\b/.test(line) && !line.includes('$(composer_security_option)')) missing.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(missing, []);
});

test('every builder that runs them takes --allow-insecure, off by default', () => {
  for (const f of ARGS) {
    const s = fs.readFileSync(path.join(SCRIPTS, 'args', f), 'utf8');
    assert.match(s, /parser\.add_argument\('--allow-insecure',\s*\n\s*action='store_true',\s*\n\s*default=False,/, f);
  }
});

/** build_distribution with a fake ddev; returns the composer calls and the output. */
function build(declare) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-insecure-'));
  const log = path.join(dir, 'ddev.log');
  fs.mkdirSync(path.join(dir, 'ws'));
  const script = `
WORKSPACE_SCRIPTS=/nowhere; WORKSPACE_ROOT=${dir}; doc_name=ws; PROJECT_NAME=p1; SKIP_DROP_DATABASE=yes; INSTALL=no; REQUIRE=(_none_); ENABLE=(_none_)
distribution_name=stub; distribution_webroot=docroot; distribution_project_template=drupal/stub; site_version=1.0.x-dev
${declare}
ddev() { printf '%s\\n' "$*" >> ${log}; return 0; }
ddev_up() { :; }; set_default_settings() { :; }; add_drush() { :; }; drush_set_debug_on() { :; }; drush_cr() { :; }; add_users() { :; }
source ${path.join(SCRIPTS, 'functions', 'fun-build-distribution.sh')}; source ${path.join(SCRIPTS, 'functions', 'fun-ddev-nodejs.sh')}
source() { if [ "$1" = "\${WORKSPACE_SCRIPTS}/functions/fun-distribution-stub.sh" ]; then
  install_stub_with_drush() { :; }; enable_stub_extra_components() { :; }
  else builtin source "$@"; fi; }
build_distribution; echo "exit=$?"
`;
  const run = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter((c) => /^composer (create-project|require|install|update)\b/.test(c)) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { calls, out: run.stdout + run.stderr };
}

test('a build asked for --allow-insecure warns once and passes --no-security-blocking to composer', () => {
  const r = build('ALLOW_INSECURE=yes');
  assert.ok(r.calls.length > 0, r.out);
  for (const c of r.calls) assert.match(c, /--no-security-blocking/, c);
  assert.strictEqual((r.out.match(/WARNING: --allow-insecure is on: composer will install packages that have a published security advisory\./g) || []).length, 1, r.out);
});

test('a build without it is as before: no option, no warning', () => {
  const r = build('');
  assert.ok(r.calls.length > 0, r.out);
  for (const c of r.calls) assert.doesNotMatch(c, /--no-security-blocking/, c);
  assert.doesNotMatch(r.out, /--allow-insecure is on/);
});
