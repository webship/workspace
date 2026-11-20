/**
 * The testing setup waits for the site after the webship-js add-on restarts the project (webship/workspace#533).
 *
 * `ddev restart` returns once the containers are up, but an app that starts on its own (a Discourse forum, seen on
 * 2026-11-20) answers later, and the platform hook that runs next wrote its accounts before the forum came back. The
 * setup now asks the site from the web container until it answers, for a limited time. A fake ddev answers here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** testing_configure on a throwaway project; the site answers the codes in `codes` one call after another. */
function configure(codes, { primary = 'https://site.ddev.site', wait = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-wait-'));
  fs.mkdirSync(path.join(root, 'dev', 'site'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site', 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'codes'), codes.join('\n') + '\n');
  const describe = JSON.stringify({ raw: { status: 'running', primary_url: primary } });
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
${wait ? `TESTING_SITE_WAIT=${wait}` : ''}
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_configure_plugins() { echo "the platform hooks run" ; }
testing_ensure_browser_libs() { : ; }
testing_install_browsers() { : ; }
testing_steps_suggest() { : ; }
sleep() { : ; }
ddev() {
  echo "ddev $*" >> ${root}/ddev.log
  if [ "$1" = "describe" ]; then echo '${describe}' ; return 0 ; fi
  if [ "$1 $2" = "exec curl" ]; then
    c=$(head -1 ${root}/codes); [ -n "$c" ] && sed -i '1d' ${root}/codes; printf '%s' "\${c:-000}" ; return 0
  fi
  return 0
}
testing_configure
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  r.ddev = fs.existsSync(path.join(root, 'ddev.log')) ? fs.readFileSync(path.join(root, 'ddev.log'), 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

test('after the add-on restart the setup waits until the site answers, then runs the platform hooks', () => {
  const r = configure(['000', '502', '200']);
  const out = r.stdout;
  assert.match(out, /Waiting for https:\/\/site\.ddev\.site to answer after the restart\./, out + r.stderr);
  assert.match(out, /The site answers \(200\) after 10 s\./);
  assert.ok(out.indexOf('The site answers') < out.indexOf('the platform hooks run'), 'the hooks run after the site answers');
  assert.strictEqual((r.ddev.match(/^ddev exec curl /gm) || []).length, 3);
});

test('a site that answers at once costs one request and says nothing', () => {
  const r = configure(['200']);
  assert.doesNotMatch(r.stdout, /Waiting for|The site answers/);
  assert.strictEqual((r.ddev.match(/^ddev exec curl /gm) || []).length, 1);
  assert.match(r.stdout, /the platform hooks run/);
});

test('a site that never answers stops the wait at the limit, says so, and the setup goes on', () => {
  const r = configure(['000', '000', '000', '000', '000'], { wait: '10' });
  assert.match(r.stdout, /did not answer within 10 s \(last answer: 000\); the setup goes on\./);
  assert.match(r.stdout, /the platform hooks run/);
});

test('without a primary URL there is nothing to wait for', () => {
  const r = configure(['000'], { primary: '' });
  assert.doesNotMatch(r.ddev, /^ddev exec curl /m);
  assert.match(r.stdout, /the platform hooks run/);
});
