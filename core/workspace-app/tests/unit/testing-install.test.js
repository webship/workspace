/**
 * The testing setup (testing_configure, cmd-tools-testing.sh <project>) stops when the project's
 * `npm install` fails, instead of saying "Testing is set up" over a project with no webship-js
 * (webship/workspace#492). The JS install runs in the project's container; a fake ddev answers here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** testing_configure on a throwaway project, with a fake ddev whose `npm install` answers `installExit`. */
function configure(installExit, { running = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-install-'));
  fs.mkdirSync(path.join(root, 'dev', 'site'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site', 'package.json'), '{}');
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_configure_plugins() { : ; }
testing_ensure_browser_libs() { echo "browser libraries" ; }
testing_install_browsers() { echo "browsers" ; }
testing_steps_suggest() { : ; }
ddev() {
  echo "ddev $*" >> ${root}/ddev.log
  if [ "$1" = "describe" ]; then [ ${running ? 1 : 0} = 1 ] && echo '{"raw":{"status":"running"}}' | tr -d ' ' ; return 0 ; fi
  if [ "$1 $2" = "npm install" ]; then
    [ ${installExit} = 0 ] && return 0
    echo "npm error 404 Not Found - GET https://registry.npmjs.org/@webship-js%2fnot-yet-steps" >&2
    return ${installExit}
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

test('a failed npm install stops the testing setup, with a non-zero status and no "set up" line', () => {
  const r = configure(1);
  assert.match(r.stdout, /status 1$/m, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /Testing is set up/);
  assert.doesNotMatch(r.stdout, /^browsers$/m, 'nothing is installed after the failed step');
  assert.match(r.stdout, /npm install failed in dev\/site, so testing is not set up/);
  assert.match(r.stderr, /404 Not Found/, "npm's own error is left as it was");
});

test('an install that works still sets testing up, the browser steps included', () => {
  const r = configure(0);
  assert.match(r.stdout, /status 0$/m, r.stdout + r.stderr);
  assert.match(r.stdout, /Testing is set up on dev\/site \(webship-js\)/);
  assert.match(r.stdout, /^browser libraries$/m);
  assert.match(r.stdout, /^browsers$/m);
});

test('a running project is not started again; a stopped one is (#511)', () => {
  const running = configure(0, { running: true });
  assert.match(running.stdout, /status 0$/m, running.stdout + running.stderr);
  assert.doesNotMatch(running.ddev, /^ddev start/m, 'no ddev start on a running project');
  const stopped = configure(0, { running: false });
  assert.match(stopped.stdout, /status 0$/m, stopped.stdout + stopped.stderr);
  assert.match(stopped.ddev, /^ddev start -y$/m, 'a stopped project is started');
});
