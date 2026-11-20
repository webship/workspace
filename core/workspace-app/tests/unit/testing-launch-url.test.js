/**
 * The suite's address when the web container has no LAUNCH_URL (webship/workspace#532).
 *
 * The webship-js add-on sets LAUNCH_URL from DDEV's primary URL. On a generic project whose router serves another
 * service (a Discourse forum, 2026-11-20) it came out empty, and the suite fell back to http://localhost:8080. The run
 * now passes the project's primary URL itself in that case, and leaves a LAUNCH_URL the container has alone.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** testing_run on a throwaway project; the container's LAUNCH_URL is `inContainer`. Returns the suite's ddev exec line. */
function run(inContainer, { primary = 'https://forum.ddev.site' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-launch-'));
  fs.mkdirSync(path.join(root, 'dev', 'forum'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'forum', 'package.json'), '{"scripts":{"test":"cucumber-js"}}');
  const describe = JSON.stringify({ raw: { status: 'running', primary_url: primary } });
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=forum
BROWSER=chromium; HEADED=no; DRY_RUN=no; RETRY=0; TAGS=_none_; TESTING_PATH=_none_
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_ensure_browser_libs() { return 0 ; }
testing_install_browsers() { return 0 ; }
ddev() {
  echo "ddev $*" >> ${root}/ddev.log
  if [ "$1" = "describe" ]; then echo '${describe}' ; return 0 ; fi
  if [ "$1 $2 $3" = "exec printenv LAUNCH_URL" ]; then printf '%s\\n' "${inContainer}" ; return 0 ; fi
  return 0
}
testing_run
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const log = fs.existsSync(path.join(root, 'ddev.log')) ? fs.readFileSync(path.join(root, 'ddev.log'), 'utf8') : '';
  fs.rmSync(root, { recursive: true, force: true });
  r.suite = log.split('\n').filter((l) => /^ddev exec .*BROWSER=chromium/.test(l)).join('\n');
  return r;
}

test('an empty LAUNCH_URL in the container: the run passes the primary URL', () => {
  const r = run('');
  assert.match(r.suite, /LAUNCH_URL=https:\/\/forum\.ddev\.site/, r.stdout + r.stderr + r.suite);
});

test('a LAUNCH_URL the container has is left alone', () => {
  const r = run('https://forum.ddev.site');
  assert.ok(r.suite.length > 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.suite, /LAUNCH_URL=/);
});

test('no LAUNCH_URL and no primary URL: nothing is added', () => {
  const r = run('', { primary: '' });
  assert.ok(r.suite.length > 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.suite, /LAUNCH_URL=/);
});
