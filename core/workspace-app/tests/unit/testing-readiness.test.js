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

const { testingReadiness, browserLibsBuilt } = require('../../test-reports');

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
