/**
 * The dashboard's own browser suite runs one feature when FEATURES names it (webship/workspace#651).
 *
 * cucumber-js 12 adds a feature named on the command line to the configured paths rather than running only it, so
 * `cucumber-js --config cucumber.js tests/features/x.feature` ran every dashboard feature. The config now takes its
 * paths from FEATURES when it is set, as the projects the testing setup makes do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');

/** The paths cucumber.js gives, read in a process of its own with the environment given. */
function paths(env) {
  const r = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./cucumber.js").default.paths))'],
    { cwd: APP, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('without FEATURES the suite is every feature; with it, only what it names', () => {
  assert.deepStrictEqual(paths({}), ['tests/features/**/*.feature']);
  assert.deepStrictEqual(paths({ FEATURES: 'tests/features/settings.feature' }), ['tests/features/settings.feature']);
  assert.deepStrictEqual(paths({ FEATURES: 'tests/features/a*.feature' }), ['tests/features/a*.feature'], 'a glob too');
  assert.ok(fs.existsSync(path.join(APP, 'tests', 'features', 'settings.feature')), 'the feature the developer guide names is there');
});

test('the developer guide says to name one feature in FEATURES, not on the command line', () => {
  const guide = fs.readFileSync(path.join(APP, 'docs', 'DEVELOPER-GUIDE.md'), 'utf8');
  assert.match(guide, /FEATURES=tests\/features\/settings\.feature npm run test:browser/);
  assert.match(guide, /Name the feature in `FEATURES`, not on the command line/);
});
