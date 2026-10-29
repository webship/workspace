/**
 * Steps that exercise an action's GUARDS over the wire, without a browser round
 * trip: post the form, read the fragment that comes back. Used for actions whose
 * happy path needs an external system (Jira through twg) — the guards answer
 * locally and deterministically either way, and they are what must not regress.
 */

'use strict';

const { When, Then } = require('@cucumber/cucumber');
const assert = require('assert');

When('I post {string} with {string}', async function (path, json) {
  const form = JSON.parse(json);
  const base = process.env.LAUNCH_URL || 'https://workspace.ddev.site';
  const response = await this.page.request.post(`${base}${path}`, { form });
  this.lastActionResponse = await response.text();
});

Then('the action response should contain {string}', function (needle) {
  assert.ok(
    (this.lastActionResponse || '').includes(needle),
    `expected the response to contain ${JSON.stringify(needle)} — got: ${(this.lastActionResponse || '').slice(0, 300)}`,
  );
});
