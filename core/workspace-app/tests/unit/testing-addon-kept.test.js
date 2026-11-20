/**
 * A testing setup goes on with the add-on a project has when getting it again fails (webship/workspace#545).
 *
 * Every setup gets the webship-js DDEV add-on again, which is how a project picks up a newer one. A DNS hiccup or
 * GitHub's rate limit used to stop the whole setup, even on a project that had the add-on installed and working.
 * A fake ddev answers here; the add-on fetch always fails.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const DNS = 'Error: unable to get webship/ddev-webship-js: Get "https://api.github.com/repos/webship/ddev-webship-js/releases": dial tcp: lookup api.github.com: no such host';
const RATE = 'Error: unable to get webship/ddev-webship-js: GET https://api.github.com/repos/webship/ddev-webship-js/releases: 403 API rate limit exceeded';

/** testing_configure on a throwaway project; `installed` puts DDEV's manifest and the add-on's config file in it. */
function configure({ installed = false, manifestOnly = false, version = 'v2.1.0', out = DNS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-addon-kept-'));
  const proj = path.join(root, 'dev', 'site');
  fs.mkdirSync(path.join(proj, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{}');
  if (installed || manifestOnly) {
    const meta = path.join(proj, '.ddev', 'addon-metadata', 'ddev-webship-js');
    fs.mkdirSync(meta, { recursive: true });
    fs.writeFileSync(path.join(meta, 'manifest.yaml'), `name: ddev-webship-js\nrepository: webship/ddev-webship-js\nversion: ${version}\n`);
    if (!manifestOnly) fs.writeFileSync(path.join(proj, '.ddev', 'config.webship-js.yml'), '#ddev-generated\n');
  }
  fs.writeFileSync(path.join(root, 'addon.out'), out);
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_configure_plugins() { echo "the platform hooks run" ; }
testing_ensure_browser_libs() { : ; }
testing_install_browsers() { : ; }
testing_steps_suggest() { : ; }
testing_wait_for_site() { echo "waited for the site" ; }
ddev() {
  echo "ddev $*" >> ${root}/ddev.log
  if [ "$1 $2" = "add-on get" ]; then cat ${root}/addon.out; echo; return 1; fi
  if [ "$1" = "describe" ]; then echo '{"raw":{"status":"running"}}' ; return 0 ; fi
  return 0
}
testing_configure
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  r.ddev = fs.existsSync(path.join(root, 'ddev.log')) ? fs.readFileSync(path.join(root, 'ddev.log'), 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

test('a project that has the add-on goes on with it when the fetch fails, and says which one', () => {
  const r = configure({ installed: true });
  assert.match(r.stdout, /status 0$/m, r.stdout + r.stderr);
  assert.match(r.stdout, /Getting the add-on again did not work \(DDEV's words are above\); this project already has it\./);
  assert.match(r.stdout, /The setup goes on with the add-on it has \(v2\.1\.0\); run it again later for a newer one\./);
  assert.match(r.stdout, /the platform hooks run/);
  assert.match(r.ddev, /^ddev npm install$/m, 'the JS dependencies are installed');
  assert.doesNotMatch(r.ddev, /^ddev restart$/m, 'no restart: nothing new was installed');
  assert.doesNotMatch(r.stdout, /waited for the site/);
});

test('GitHub\'s rate limit gets the token hint, and the setup still goes on', () => {
  const r = configure({ installed: true, out: RATE });
  assert.match(r.stdout, /status 0$/m, r.stdout + r.stderr);
  assert.match(r.stdout, /GitHub answered with its rate limit: a token avoids it \(export DDEV_GITHUB_TOKEN=\$\(gh auth token\)\)\./);
});

test('a project without the add-on still stops, with what the failure means', () => {
  const r = configure();
  assert.match(r.stdout, /status 1$/m, r.stdout + r.stderr);
  assert.match(r.stdout, /The add-on could not be installed; DDEV's own words are above\./);
  assert.doesNotMatch(r.stdout, /the platform hooks run/);
  assert.doesNotMatch(r.ddev, /npm install/);
});

test('a manifest without the add-on\'s config file is not an installed add-on', () => {
  const r = configure({ manifestOnly: true });
  assert.match(r.stdout, /status 1$/m, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /this project already has it/);
});

test('a manifest with no version still reads well', () => {
  const r = configure({ installed: true, version: '' });
  assert.match(r.stdout, /The setup goes on with the add-on it has; run it again later for a newer one\./, r.stdout);
});
