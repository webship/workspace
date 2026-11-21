/**
 * A dry run fails on steps that do not resolve (webship/workspace#486).
 *
 * cucumber-js never fails a dry run: with an undefined or ambiguous step it still exits 0, and the summary says
 * "2 steps (1 undefined, 1 skipped)". A dry run is the check that every step resolves, so `--dry-run` printed
 * "The suite passed" for features whose steps a removed pack had defined. The run now reads that summary line.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
const ESC = '\\033';

/** testing_run on a throwaway project whose suite prints `summary` and exits `code`. */
function run({ dry, summary, code = 0, tags = '_none_' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-dry-'));
  fs.mkdirSync(path.join(root, 'dev', 'site'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev', 'site', 'package.json'), '{"scripts":{"test":"cucumber-js"}}');
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME=site
BROWSER=chromium; HEADED=no; DRY_RUN=${dry ? 'yes' : 'no'}; RETRY=_none_; TAGS=${tags}; TESTING_PATH=_none_
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_ensure_browser_libs() { return 0 ; }
testing_install_browsers() { return 0 ; }
ddev() {
  if [ "$1 $2 $3" = "exec printenv LAUNCH_URL" ]; then echo https://site.ddev.site ; return 0 ; fi
  if [ "$1" = "exec" ]; then printf 'Feature: x\\n\\n1 scenario (1 undefined)\\n${summary}\\n0m00.005s (executing steps: 0m00.000s)\\n' ; return ${code} ; fi
  return 0
}
testing_run
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(root, { recursive: true, force: true });
  r.status_ = Number((r.stdout.match(/^status (\d+)$/m) || [])[1]);
  return r;
}

test('a dry run with an undefined step fails, and says how many, though cucumber-js exits 0', () => {
  const r = run({ dry: true, summary: `2 steps (${ESC}[33m1 undefined${ESC}[39m, ${ESC}[36m1 skipped${ESC}[39m)` });
  assert.strictEqual(r.status_, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Steps that do not resolve: 1 undefined\. A real run fails on them\./);
  assert.match(r.stdout, /The dry run FAILED \(exit 1\)/);
  assert.doesNotMatch(r.stdout, /passed|Every step resolves/);
});

test('ambiguous steps count too', () => {
  const r = run({ dry: true, summary: '4 steps (2 undefined, 1 ambiguous, 1 skipped)' });
  assert.strictEqual(r.status_, 1);
  assert.match(r.stdout, /Steps that do not resolve: 2 undefined, 1 ambiguous\./);
});

test('a dry run where every step resolves says so, and passes', () => {
  const r = run({ dry: true, summary: '2 steps (2 skipped)' });
  assert.strictEqual(r.status_, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Every step resolves \(a dry run, no browser\)/);
  assert.doesNotMatch(r.stdout, /do not resolve|FAILED/);
});

test('a real run is read as before: cucumber-js fails it on an undefined step itself', () => {
  let r = run({ dry: false, tags: '@smoke', summary: '2 steps (1 undefined, 1 passed)', code: 1 });
  assert.strictEqual(r.status_, 1);
  assert.match(r.stdout, /The suite FAILED \(exit 1\)/);
  assert.doesNotMatch(r.stdout, /do not resolve/);
  r = run({ dry: false, tags: '@smoke', summary: '2 steps (2 passed)' });
  assert.strictEqual(r.status_, 0);
  assert.match(r.stdout, /The suite passed in/);
});
