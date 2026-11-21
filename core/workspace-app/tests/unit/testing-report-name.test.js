/**
 * The HTML test report is named after the project, not "project-name" (webship/workspace#679).
 *
 * webship-js names its report from --name or WEBSHIP_REPORT_NAME, else from package.json, which init-webship-js writes
 * as "project-name" on a project that had none (WordPress and most platforms). The testing command now passes
 * WEBSHIP_REPORT_NAME with every run, and to generate-reports when it writes the report itself.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');

/** testing_run on a throwaway project; every `ddev exec` command line it makes, one per line. */
function run({ tags = '_none_', reportJsonOnly = false, name = 'site' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-testing-name-'));
  const p = path.join(root, 'dev', name);
  fs.mkdirSync(path.join(p, 'tests', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(p, 'package.json'), '{"name":"project-name","scripts":{"test":"cucumber-js","generate-reports":"generate-reports"}}');
  if (reportJsonOnly) fs.writeFileSync(path.join(p, 'tests', 'reports', 'cucumber_report.json'), '[]');
  const log = path.join(root, 'exec.log');
  const script = `
source ${SCRIPTS}/functions/fun-testing.sh
WORKSPACE_ROOT=${root}; doc_name=dev; PROJECT_NAME='${name}'
BROWSER=chromium; HEADED=no; DRY_RUN=no; RETRY=_none_; TAGS='${tags}'; TESTING_PATH=_none_
testing_require_project() { return 0 ; }
testing_stack() { printf 'webship-js' ; }
testing_ensure_browser_libs() { return 0 ; }
testing_install_browsers() { return 0 ; }
ddev() {
  if [ "$1 $2 $3" = "exec printenv LAUNCH_URL" ]; then echo https://site.ddev.site ; return 0 ; fi
  if [ "$1" = "exec" ]; then shift ; printf '%s\\n' "$*" >> '${log}' ; printf '1 scenario (1 passed)\\n' ; return 0 ; fi
  return 0
}
testing_run
echo "status $?"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  const execs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  fs.rmSync(root, { recursive: true, force: true });
  return { ...r, execs };
}

test('a run of the whole suite passes the project\'s name for its report', () => {
  const r = run();
  const suite = r.execs.find((l) => / run test:chromium$/.test(l));
  assert.ok(suite, r.stdout + r.stderr + r.execs.join('\n'));
  assert.match(suite, /(^| )WEBSHIP_REPORT_NAME=site( |$)/);
});

test('a filtered run passes it too', () => {
  const r = run({ tags: '@critical' });
  const suite = r.execs.find((l) => /cucumber\.js --config cucumber\.js/.test(l));
  assert.ok(suite, r.execs.join('\n'));
  assert.match(suite, /(^| )WEBSHIP_REPORT_NAME=site( |$)/);
  assert.match(suite, /--tags "@critical"/);
});

test('when the command writes the HTML report itself, generate-reports gets the name', () => {
  const r = run({ reportJsonOnly: true });
  const gen = r.execs.find((l) => /run generate-reports$/.test(l));
  assert.ok(gen, r.execs.join('\n'));
  assert.match(gen, /^WEBSHIP_REPORT_NAME=site npm run generate-reports$/);
});

test('a name with a character the shell reads is passed as one word', () => {
  const r = run({ name: 'my site' });
  const suite = r.execs.find((l) => / run test:chromium$/.test(l));
  assert.match(suite, /WEBSHIP_REPORT_NAME=my\\ site /);
});
