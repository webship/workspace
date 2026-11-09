/**
 * The clone action, exercised on whatever project the dev workspace holds first, so the scenarios
 * name no project of one machine (#89). The project is read from the tree the dashboard serves.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('assert');

const APP = path.join(__dirname, '..', '..');
const BASE = () => process.env.LAUNCH_URL || 'https://workspace.ddev.site';

function firstProject(wsKey) {
  const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
  const dir = loadWorkspaces()[wsKey].dir;
  const first = fs.readdirSync(dir).filter((p) => !p.startsWith('.') && fs.statSync(path.join(dir, p)).isDirectory()).sort()[0];
  assert.ok(first, `the ${wsKey} workspace holds no project to clone`);
  return first;
}

Given('{string} is the first project of the {string} workspace', function (alias, wsKey) {
  this.cloneProject = firstProject(wsKey); this.cloneWorkspace = wsKey;
});

When('I open the clone form of the first project in {string}', async function (wsKey) {
  this.cloneProject = firstProject(wsKey); this.cloneWorkspace = wsKey;
  await this.page.goto(`${BASE()}/fragments/projects/clone-form/${wsKey}/${encodeURIComponent(this.cloneProject)}`, { waitUntil: 'domcontentloaded' });
});

Then('the clone form proposes a copy of that project', async function () {
  await this.page.locator(`input[name='to'][value='${this.cloneProject}-copy']`).waitFor({ state: 'attached', timeout: 10000 });
});

When('I ask the live check about the name of the first project in {string}', async function (wsKey) {
  this.cloneProject = firstProject(wsKey); this.cloneWorkspace = wsKey;
  await this.page.goto(`${BASE()}/fragments/projects/clone-check?to=${encodeURIComponent(this.cloneProject)}&toWorkspace=${wsKey}`, { waitUntil: 'domcontentloaded' });
});

When('I post a clone of the first project in {string} over itself', async function (wsKey) {
  this.cloneProject = firstProject(wsKey); this.cloneWorkspace = wsKey;
  const form = { workspace: wsKey, projectName: this.cloneProject, to: this.cloneProject, toWorkspace: wsKey };
  const response = await this.page.request.post(`${BASE()}/actions/clone-project`, { form });
  this.lastActionResponse = await response.text();
});
