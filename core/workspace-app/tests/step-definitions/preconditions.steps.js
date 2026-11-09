/**
 * Scenarios that need a state this machine may not be in, skipped WITH THE REASON.
 *
 * The suite runs against the live dashboard by design, so some scenarios describe real
 * behaviour that can only be observed when the machine is set up for it: Jira writes
 * switched off, a project that has actually been tested, a project that declares
 * individual check aliases. On a machine without that state they failed, and a suite with
 * permanent red in it stops being read — which is how this one drifted for weeks without
 * anyone noticing it could not even launch a browser.
 *
 * The alternative — excluding them in cucumber.js — hides them completely, and a test
 * nobody can see is a test nobody will fix. Returning 'skipped' from the hook keeps them in
 * the run, in the output and counted, with the reason attached to the report:
 *
 *     - # tests/features/jira-tasks.feature:16
 *       SKIPPED: jira.allow_writes is true on this machine …
 *
 * (`this.skip()` is Mocha's API, not cucumber's — the first version of this file used it and
 * the scenarios ran and failed exactly as before.)
 *
 * Each precondition is checked at run time against the real machine, so the moment the
 * state exists the scenario becomes a real test again with no edit here.
 */

const fs = require('fs');
const path = require('path');
const { Before } = require('@cucumber/cucumber');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP = path.join(__dirname, '..', '..');

/** A scalar out of a YAML file, read the way the dashboard reads it: line by line. */
function settingValue(key) {
  try {
    const yml = fs.readFileSync(path.join(ROOT, 'core', 'config', 'settings.yml'), 'utf8');
    const m = yml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '') : '';
  } catch (_) { return ''; }
}

Before({ tags: '@needs-jira-writes-off' }, function () {
  // The scenario asserts that write modes are REFUSED, which is only true when writes are
  // off. With them on, refusing would be the bug.
  if (settingValue('allow_writes') === 'true') {
    this.attach('SKIPPED: jira.allow_writes is true on this machine, so write modes are '
      + 'allowed — this scenario describes the refusal that only happens when it is false.');
    return 'skipped';
  }
  return undefined;
});

Before({ tags: '@needs-test-report' }, function () {
  // The Tests menu links a report only where one exists; the report pages need one to read.
  const anyReport = (() => {
    try {
      const dev = path.join(ROOT, 'dev');
      return fs.readdirSync(dev).some((p) => {
        const dir = path.join(dev, p, 'tests', 'reports');
        try { return fs.readdirSync(dir).some((f) => f.endsWith('.json')); } catch (_) { return false; }
      });
    } catch (_) { return false; }
  })();
  if (!anyReport) {
    this.attach('SKIPPED: no project in dev/ has a test report yet — run a suite on one '
      + '(its Tests menu, or cmd-tools-testing.sh) and this becomes a real test again.');
    return 'skipped';
  }
  return undefined;
});

Before({ tags: '@needs-check-aliases' }, function () {
  // /actions/checks renders only for an alias whose status is READY. Declaring one is not
  // enough: every alias in products/ is currently "no node_modules/.bin and no .pnp.cjs —
  // pass --install", so they render as disabled spans and the runnable control correctly
  // does not exist. Asking the app's own checksRowsOf rather than re-deriving it from
  // package.json, because a precondition that guesses at the rule drifts from the rule —
  // the first version of this hook checked "declares a lint/test script" and let the
  // scenario run against sixteen aliases that could not be run.
  let anyReady = false;
  try {
    const { checksRowsOf } = require(path.join(APP, 'checks'));
    const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
    const dir = loadWorkspaces().products.dir;
    for (const p of fs.readdirSync(dir)) {
      if (!fs.statSync(path.join(dir, p)).isDirectory()) continue;
      const rows = checksRowsOf('products', dir, p) || [];
      if (rows.some((r) => r.status === 'ready')) { anyReady = true; break; }
    }
  } catch (_) { anyReady = false; }
  if (!anyReady) {
    this.attach('SKIPPED: no project in products/ has a RUNNABLE check alias — they are '
      + 'declared but their dependencies are not installed, so every alias renders disabled '
      + 'and the per-alias control has nothing to offer. Install deps in one and this '
      + 'becomes a real test again.');
    return 'skipped';
  }
  return undefined;
});

Before({ tags: '@needs-testing-stack' }, function () {
  // A row offers "Run the tests" only when the project has a testing stack (a webship-js project,
  // or the init-full-automated-testing command); the Tests menu of a bare site has nothing to run.
  let any = false;
  try {
    const { testingStackOf } = require(path.join(APP, 'test-reports'));
    const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
    const dir = loadWorkspaces().dev.dir;
    any = fs.readdirSync(dir).some((p) => {
      try { return fs.statSync(path.join(dir, p)).isDirectory() && testingStackOf(dir, p) !== 'none'; } catch (_) { return false; }
    });
  } catch (_) { any = false; }
  if (!any) {
    this.attach('SKIPPED: no project in dev/ has a testing stack (a cucumber.js, tests/step-definitions, '
      + 'or the init-full-automated-testing command), so no row offers "Run the tests". Set one up and '
      + 'this becomes a real test again.');
    return 'skipped';
  }
  return undefined;
});

Before({ tags: '@needs-running-project' }, function () {
  // The card shows a project's host only while DDEV reports it running.
  let any = false;
  try {
    const { execFileSync } = require('child_process');
    const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
    const dir = fs.realpathSync(loadWorkspaces().dev.dir);
    const out = JSON.parse(execFileSync('ddev', ['list', '--json-output'], { encoding: 'utf8', timeout: 60000 }));
    any = (out.raw || []).some((p) => p.status === 'running' && String(p.approot || '').startsWith(dir + path.sep));
  } catch (_) { any = false; }
  if (!any) {
    this.attach('SKIPPED: no project in dev/ is running (ddev list), so no card shows a host. Start one '
      + 'and this becomes a real test again.');
    return 'skipped';
  }
  return undefined;
});

/** A scalar out of a plugin's own settings file (core/config/plugin.<name>.settings.yml), or ''. */
function pluginSettingValue(plugin, key) {
  try {
    const yml = fs.readFileSync(path.join(ROOT, 'core', 'config', `plugin.${plugin}.settings.yml`), 'utf8');
    const m = yml.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '') : '';
  } catch (_) { return ''; }
}

// A plugin ships features into this suite but no hooks, so it states a precondition in its tag:
// `@needs-setting-<plugin>-<key>` skips the scenario, with the reason, while that key has no value in
// the plugin's settings file. The plugin name ends at the first hyphen that is followed by the key,
// so a plugin named with hyphens tags `@needs-setting-google-drive-folder_id` and the key is the part
// after the last plugin-name hyphen: the key itself never contains a hyphen (settings keys are snake_case).
const NEEDS_SETTING = /^@needs-setting-(.+)-([a-z0-9_]+)$/;
Before(function (scenario) {
  for (const t of scenario.pickle.tags || []) {
    const m = NEEDS_SETTING.exec(t.name);
    if (!m) continue;
    const [, plugin, key] = m;
    if (!pluginSettingValue(plugin, key)) {
      this.attach(`SKIPPED: core/config/plugin.${plugin}.settings.yml has no ${key} on this machine; `
        + `set it and this becomes a real test again.`);
      return 'skipped';
    }
  }
  return undefined;
});

module.exports = { settingValue, pluginSettingValue, APP };
