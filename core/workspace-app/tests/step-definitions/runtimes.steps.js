/**
 * A site on another container runtime than DDEV (Docker Compose, Podman, Kubernetes), on the dashboard
 * (webship/workspace#694). The features under tests/features/runtimes/ name no project of one machine: the site is
 * the first running one of that runtime the workspace holds, read from the tree the dashboard serves.
 *
 * `@needs-runtime-<docker|podman|kubernetes>`: the scenario reads and drives a real, running site of that runtime
 * (a builder run with `--runtime <name>`). Where the workspace has none, or it is stopped, or the runtime does not
 * answer (no cluster on a runner), the scenario is skipped with the reason, like the other preconditions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Before, Given, When, Then } = require('@cucumber/cucumber');

const APP = path.join(__dirname, '..', '..');
const BASE = () => process.env.LAUNCH_URL || 'https://workspace.ddev.site';
const TITLES = { docker: 'Docker Compose', podman: 'Podman', kubernetes: 'Kubernetes' };

/** Every site of a runtime in the workspace's project folders: [{ folder, name, project }]. */
function sitesOf(runtime) {
  const { loadWorkspaces } = require(path.join(APP, 'workspaces'));
  const { listProjects } = require(path.join(APP, 'jobs'));
  const { readProject } = require(path.join(APP, 'project-runtime'));
  const found = [];
  for (const [folder, ws] of Object.entries(loadWorkspaces())) {
    if (!ws || ws.kind !== 'projects' || !ws.dir || !fs.existsSync(ws.dir)) continue;
    let names = [];
    try { names = listProjects(ws.dir); } catch (_) { continue; }
    for (const name of names) {
      const project = readProject(path.join(ws.dir, name));
      if (project.runtime === runtime) found.push({ folder, name, project });
    }
  }
  return found;
}

/** The first running site of a runtime, or why there is none. */
async function runningSite(runtime) {
  const sites = sitesOf(runtime);
  if (!sites.length) return { why: `the workspace holds no site on ${TITLES[runtime]} (build one with --runtime ${runtime})` };
  const projectRuntime = require(path.join(APP, 'project-runtime'));
  projectRuntime.invalidate();
  const states = await projectRuntime.statesFor(sites.map((s) => s.project));
  const site = sites.find((s) => states.get(s.project.root) === 'running');
  if (!site) return { why: `no site on ${TITLES[runtime]} is running (${sites.map((s) => `${s.folder}/${s.name}: ${states.get(s.project.root)}`).join(', ')}); start one` };
  return { site };
}

const NEEDS_RUNTIME = /^@needs-runtime-(docker|podman|kubernetes)$/;
Before(async function (scenario) {
  for (const t of scenario.pickle.tags || []) {
    const m = NEEDS_RUNTIME.exec(t.name);
    if (!m) continue;
    const { site, why } = await runningSite(m[1]);
    if (!site) {
      this.attach(`SKIPPED: ${why}, and this becomes a real test again.`);
      return 'skipped';
    }
    this.runtimeSite = site;
  }
  return undefined;
});

function siteOf(world, runtime) {
  const site = world.runtimeSite;
  assert.ok(site && site.project.runtime === runtime, `the scenario is not tagged @needs-runtime-${runtime}`);
  return site;
}
/** The site's own card: the one whose runtime menu loads this project's body. */
const rowOf = (world, site) => world.page.locator(`.project-row:has([hx-get="/fragments/row-menu/runtime/${site.folder}/${site.name}"])`);

Given('I am on the folder of the {string} site', async function (runtime) {
  const site = siteOf(this, runtime);
  await this.page.goto(`${BASE()}/${site.folder}`, { waitUntil: 'domcontentloaded' });
  await rowOf(this, site).waitFor({ state: 'visible', timeout: 20000 });
});

Then('the row of the {string} site should show {string}', async function (runtime, word) {
  const site = siteOf(this, runtime);
  await rowOf(this, site).locator('.state-chip', { hasText: word }).waitFor({ state: 'visible', timeout: 15000 });
});

// The page is not reloaded: the row hears when the verb's session is done and draws itself again.
// A step may wait longer than the suite's 45 seconds for one: the wait is the scenario's own number.
Then('the row of the {string} site should show {string} within {int} seconds', { timeout: 20 * 60 * 1000 }, async function (runtime, word, seconds) {
  const site = siteOf(this, runtime);
  await rowOf(this, site).locator('.state-chip', { hasText: word }).waitFor({ state: 'visible', timeout: seconds * 1000 });
});

Then('the row of the {string} site should link to the address of its runtime', async function (runtime) {
  const site = siteOf(this, runtime);
  const href = await rowOf(this, site).locator('a.pcard-host').getAttribute('href', { timeout: 15000 });
  assert.match(href, runtime === 'kubernetes' ? new RegExp(`^http://[0-9a-f.:\\[\\]]+:${site.project.port}$`) : new RegExp(`^http://127\\.0\\.0\\.1:${site.project.port}$`));
  assert.doesNotMatch(href, /ddev\.site/);
  const launch = await rowOf(this, site).locator('a.pcard-launch').getAttribute('href');
  assert.strictEqual(launch, href, 'Launch opens the same address');
});

Then('the address of the {string} site should answer', async function (runtime) {
  const site = siteOf(this, runtime);
  const href = await rowOf(this, site).locator('a.pcard-host').getAttribute('href', { timeout: 15000 });
  const response = await this.page.request.get(href, { timeout: 30000 });
  assert.ok(response.status() < 500, `${href} answered ${response.status()}`);
});

Then('the row of the {string} site should carry the {string} menu and no DDEV menu', async function (runtime, label) {
  const site = siteOf(this, runtime);
  const button = rowOf(this, site).locator(`.act-menu-runtime.act-menu-runtime-${runtime} > button`);
  await button.waitFor({ state: 'attached', timeout: 15000 });
  assert.match((await button.textContent()).trim(), new RegExp(`^${label}$`));
  assert.strictEqual(await rowOf(this, site).locator('.act-menu-ddev, .act-ddev-config').count(), 0, 'no DDEV menu and no Configure DDEV');
});

/** An entry whose label starts with the words: "Start" is not "Restart". */
const startsWith = (words) => new RegExp(`^\\s*${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

When('I open the {string} menu of the {string} site', async function (slot, runtime) {
  const site = siteOf(this, runtime);
  const menu = rowOf(this, site).locator(`.act-menu-${slot}`);
  await menu.locator('> button').click();
  const drop = menu.locator('.uk-dropdown.uk-open');
  await drop.waitFor({ state: 'visible', timeout: 10000 });
  // The body arrives when the menu opens.
  await drop.locator('a').first().waitFor({ state: 'visible', timeout: 15000 });
  this.openMenu = drop;
});

Then('the open menu should offer {string}', async function (words) {
  assert.ok(this.openMenu, 'no menu was opened');
  await this.openMenu.locator('a', { hasText: startsWith(words) }).first().waitFor({ state: 'visible', timeout: 10000 });
});

Then('the open menu should not offer {string}', async function (words) {
  assert.ok(this.openMenu, 'no menu was opened');
  assert.strictEqual(await this.openMenu.locator('a', { hasText: startsWith(words) }).count(), 0, `the menu offers "${words}"`);
});

Then('the open menu should say {string}', async function (words) {
  assert.ok(this.openMenu, 'no menu was opened');
  await this.openMenu.getByText(words).first().waitFor({ state: 'visible', timeout: 10000 });
});

When('I choose {string} in the open menu', async function (words) {
  assert.ok(this.openMenu, 'no menu was opened');
  await this.openMenu.locator('a', { hasText: startsWith(words) }).first().click();
});

module.exports = { sitesOf, runningSite };
