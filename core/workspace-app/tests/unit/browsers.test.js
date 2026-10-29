/**
 * The Screens page lists the automation browsers a session leaves running. The
 * listing itself needs a live browser; the PARSING does not, so the real
 * command lines are pinned here — including the ones that must NOT be listed.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { parseBrowserLine } = require('../../screens');

// A real Playwright MCP browser, as `ps -eo pid,etime,args` prints it.
const MCP_CHROME = '1359368 12:03 /opt/google/chrome/chrome --disable-field-trial-config --no-first-run '
  + '--user-data-dir=/home/rajab/.cache/ms-playwright-mcp/mcp-chrome-fe954a1 --remote-debugging-pipe about:blank';

test('a Playwright MCP browser is recognised, with its profile', () => {
  const b = parseBrowserLine(MCP_CHROME);
  assert.ok(b, 'the line is a browser');
  assert.strictEqual(b.pid, '1359368');
  assert.strictEqual(b.profile, 'mcp-chrome-fe954a1');
  assert.strictEqual(b.pipe, true, 'driven over a pipe');
  assert.strictEqual(b.port, '', 'so there is no DevTools port to offer');
  assert.strictEqual(b.headless, false);
});

test('a headless browser with a debugging port reports both', () => {
  const b = parseBrowserLine('4242 00:31 /usr/lib/chromium/chromium --headless=new --no-sandbox '
    + '--remote-debugging-port=9222 --user-data-dir=/tmp/pw-profile about:blank');
  assert.ok(b);
  assert.strictEqual(b.headless, true);
  assert.strictEqual(b.port, '9222');
  assert.strictEqual(b.profile, 'pw-profile');
});

test('renderer processes and ordinary browsers are not listed', () => {
  // A renderer child: same binary, but it is not the browser.
  assert.strictEqual(parseBrowserLine('1359377 12:03 /opt/google/chrome/chrome --type=zygote '
    + '--user-data-dir=/home/rajab/.cache/ms-playwright-mcp/mcp-chrome-fe954a1'), null);
  // The docs tooling's screenshot chromium: no automation flags, no profile.
  assert.strictEqual(parseBrowserLine('68819 11:00 /usr/lib/chromium/chromium --show-component-extension-options'), null);
  // Not a browser at all.
  assert.strictEqual(parseBrowserLine('999 00:02 /usr/bin/node server.js'), null);
  assert.strictEqual(parseBrowserLine('not a ps line'), null);
});

// After the sessions moved to the machine the dashboard shares its pid
// namespace, so `ps` in here also lists the suite's browser inside a project's
// web container, and the wrappers that merely mention chromium on their command
// line. Neither is a browser on the desktop.
test('the suite runner and its docker wrapper are not browsers', () => {
  const lines = [
    ' 841992       02:26 ddev exec PLAYWRIGHT_BROWSERS_PATH=/mnt/ddev-global-cache/ms-playwright BROWSER=chromium yarn run test:chromium',
    ' 842061       02:26 /home/rajab/.ddev/bin/docker-compose -f /home/rajab/workspace/dev/v11x00b1/.ddev/.ddev-docker-compose-full.yaml exec web bash -c set -eu && ( PLAYWRIGHT_BROWSERS_PATH=/mnt/ddev-global-cache/ms-playwright BROWSER=chromium yarn run test:chromium)',
    ' 842084       02:26 bash -c set -eu && ( PLAYWRIGHT_BROWSERS_PATH=/mnt/ddev-global-cache/ms-playwright BROWSER=chromium yarn run test:chromium)',
  ];
  for (const line of lines) {
    assert.equal(parseBrowserLine(line), null, `not a browser: ${line.slice(0, 60)}`);
  }
});

test('a headless shell is headless even without the flag', () => {
  const b = parseBrowserLine(' 855556       00:04 /mnt/ddev-global-cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell --remote-debugging-pipe --user-data-dir=/tmp/playwright_chromiumdev_profile-ZAMCsO');
  assert.ok(b, 'the headless shell is a browser');
  assert.equal(b.headless, true, 'the binary alone says it has no window');
  assert.equal(b.pipe, true);
});

// A browser inside a project's web container: this process cannot read its
// cmdline, so `ps` prints the executable path alone — cut, here, at the
// directory that names the build.
test('a browser in another container is still listed', () => {
  const b = parseBrowserLine(' 860652       00:21 /mnt/ddev-global-cache/ms-playwright/chromium_headless_shell');
  assert.ok(b, 'the path alone is enough to know what it is');
  assert.equal(b.headless, true, 'the build directory says headless shell');
  assert.equal(b.profile, 'test browser');
});
