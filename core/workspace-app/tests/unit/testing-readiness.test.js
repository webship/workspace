/**
 * Whether a project can start a suite: the browser libraries part (#525).
 *
 * The libraries come from a build file of the web image. The workspace writes Dockerfile.playwright; the
 * webship-js DDEV add-on writes Dockerfile.webship-js. A project set up through the add-on ran its suite green
 * while the Testing card said the libraries were missing, because only the first name was looked for.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnSync } = require('child_process');

const { testingReadiness, browserLibsBuilt, browserLibsSeen } = require('../../test-reports');
const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-readiness-'));
  const root = path.join(dir, 'site');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  fs.mkdirSync(root, { recursive: true });
  return { dir, root };
}

const PLAYWRIGHT = 'RUN npx --yes playwright@1.56 install-deps chromium || apt-get install -y libnspr4 libnss3\n';
const ADDON = 'RUN sudo -u $username npx playwright install-deps \\\n  && sudo -u $username npx playwright install\n';

test('the workspace\'s own Dockerfile.playwright counts', () => {
  const { root } = project({ '.ddev/web-build/Dockerfile.playwright': PLAYWRIGHT });
  assert.strictEqual(browserLibsBuilt(root), true);
});

test('the webship-js add-on\'s Dockerfile.webship-js counts', () => {
  const { root } = project({ '.ddev/web-build/Dockerfile.webship-js': ADDON });
  assert.strictEqual(browserLibsBuilt(root), true);
});

test('a disabled build file, one that installs something else, or none at all does not count', () => {
  assert.strictEqual(browserLibsBuilt(project({ '.ddev/web-build/disabled.Dockerfile.webship-js': ADDON }).root), false);
  assert.strictEqual(browserLibsBuilt(project({ '.ddev/web-build/Dockerfile.redis': 'RUN apt-get install -y redis-tools\n' }).root), false);
  assert.strictEqual(browserLibsBuilt(project({ 'README.md': 'no .ddev here\n' }).root), false);
});

test('a project set up through the add-on is ready, with nothing missing', () => {
  const { dir } = project({
    'cucumber.js': 'module.exports = {};\n',
    'node_modules/@cucumber/cucumber/package.json': '{"name":"@cucumber/cucumber"}\n',
    '.ddev/web-build/Dockerfile.webship-js': ADDON,
  });
  const r = testingReadiness(dir, 'site');
  assert.deepStrictEqual({ libs: r.libs, ready: r.ready, missing: r.missing }, { libs: true, ready: true, missing: [] });
});

test('without any build file the card still names the browser libraries as missing', () => {
  const { dir } = project({ 'cucumber.js': 'module.exports = {};\n', 'node_modules/@cucumber/cucumber/package.json': '{}\n' });
  assert.deepStrictEqual(testingReadiness(dir, 'site').missing, ['the browser libraries']);
});

test('an image that has the libraries without a build file is ready once the testing command saw them there (#487)', () => {
  const files = {
    'cucumber.js': 'module.exports = {};\n',
    'node_modules/@cucumber/cucumber/package.json': '{"name":"@cucumber/cucumber"}\n',
  };
  let { dir, root } = project(files);
  assert.deepStrictEqual(testingReadiness(dir, 'site').missing, ['the browser libraries'], 'nothing says so yet');
  ({ dir, root } = project({ ...files, 'node_modules/.cache/webship-workspace/browser-libs': '2026-11-21T09:00:00Z\n' }));
  assert.strictEqual(browserLibsSeen(root), true);
  assert.deepStrictEqual(testingReadiness(dir, 'site'), { stack: 'webship-js', deps: true, libs: true, ready: true, missing: [] });
});

/** testing_ensure_browser_libs on a throwaway project, with the container answering `has` (before and after a rebuild). */
function ensure(root, has) {
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
ddev() {
  if [ "$1" = "exec" ]; then ${has === 'never' ? 'return 1' : has === 'after-restart' ? '[ -f ' + JSON.stringify(path.join(root, 'restarted')) + ' ]; return $?' : 'return 0'} ; fi
  if [ "$1" = "restart" ]; then touch ${JSON.stringify(path.join(root, 'restarted'))} ; return 0 ; fi
  return 0
}
testing_ensure_browser_libs ${JSON.stringify(root)}
echo "status $?"`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}
const mark = (root) => path.join(root, 'node_modules', '.cache', 'webship-workspace', 'browser-libs');

test('the testing command leaves the mark when the container has the libraries, and takes it away when it does not', () => {
  // The container has them: the mark, and no build file written.
  let { root } = project({ 'package.json': '{}\n' });
  let r = ensure(root, 'always');
  assert.match(r.stdout, /status 0/, r.stdout + r.stderr);
  assert.match(fs.readFileSync(mark(root), 'utf8'), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
  assert.ok(!fs.existsSync(path.join(root, '.ddev', 'web-build', 'Dockerfile.playwright')));
  // Missing, then there after the rebuild: the mark.
  ({ root } = project({ 'package.json': '{}\n' }));
  r = ensure(root, 'after-restart');
  assert.match(r.stdout, /The browser libraries are in place\.\nstatus 0/);
  assert.ok(fs.existsSync(mark(root)));
  // Missing even after the rebuild: an old mark goes.
  ({ root } = project({ 'package.json': '{}\n', 'node_modules/.cache/webship-workspace/browser-libs': 'old\n' }));
  r = ensure(root, 'never');
  assert.match(r.stdout, /still missing after the rebuild/);
  assert.match(r.stdout, /status 1/);
  assert.ok(!fs.existsSync(mark(root)), 'not said to be there when it is not');
});
