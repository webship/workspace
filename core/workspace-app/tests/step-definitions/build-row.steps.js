/**
 * A build started from a folder's Build form, and the project's row once the build ends (webship/workspace#894).
 *
 * `@needs-builder-ci-row`: the scenario builds with sandboxes/cmd-ci-row-project.sh, a builder that makes a small site
 * on Docker Compose. CI places it beside the other builders of the folder; a workspace without it skips the scenario,
 * with the reason.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Before, When, Then } = require('@cucumber/cucumber');

const APP = path.join(__dirname, '..', '..');
const BUILDER = 'cmd-ci-row-project.sh';

Before({ tags: '@needs-builder-ci-row' }, function () {
  let dir = '';
  try {
    const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
    dir = (loadWorkspaces().sandboxes || {}).dir || '';
  } catch (_) { dir = ''; }
  if (!dir || !fs.existsSync(path.join(dir, BUILDER))) {
    this.attach(`SKIPPED: the sandboxes folder has no ${BUILDER} (CI places it: a builder that makes a small site on `
      + 'Docker Compose); with it this becomes a real test again.');
    return 'skipped';
  }
  return undefined;
});

When('I build {string} with the builder {string}', async function (name, script) {
  const form = this.page.locator('form.build-form').first();
  await form.locator('select[name="script"]').selectOption(script);
  await form.locator('input[name="projectName"]').fill(name);
  // A mark only this page holds: a reload loses it.
  await this.page.evaluate(() => { window.webshipNotReloaded = true; });
  await form.getByRole('button', { name: 'Build', exact: true }).click();
});

// The page is not reloaded: the row hears when the build's session is done and draws itself again. A step may wait
// longer than the suite's 45 seconds: the wait is the scenario's own number.
Then('the row of the project {string} should show {string} within {int} seconds', { timeout: 20 * 60 * 1000 }, async function (name, word, seconds) {
  const row = this.page.locator('.project-row').filter({ has: this.page.locator(`[hx-vals*='"projectName":"${name}"'], [hx-get$="/${name}"]`) }).first();
  await row.locator('.state-chip', { hasText: word }).waitFor({ state: 'visible', timeout: seconds * 1000 });
});

Then('the page should not have been reloaded since the build started', async function () {
  assert.strictEqual(await this.page.evaluate(() => window.webshipNotReloaded === true), true, 'the page was reloaded: a reload, not the page hearing the build end, drew the row');
});
