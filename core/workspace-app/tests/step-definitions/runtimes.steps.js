/**
 * A site on another container runtime than DDEV (Docker Compose, Podman, Kubernetes), on the dashboard
 * (webship/workspace#694). The features under tests/features/runtimes/ name no project of one machine: the site is
 * the first running one of that runtime the workspace holds, read from the tree the dashboard serves.
 *
 * `@needs-runtime-<docker|podman|kubernetes>`: the scenario reads and drives a real, running site of that runtime
 * (a builder run with `--runtime <name>`). Where the workspace has none, or it is stopped, or the runtime does not
 * answer (no cluster on a runner), the scenario is skipped with the reason, like the other preconditions.
 *
 * `@needs-platform-<name>` beside it: the site is one of that platform (its project type, or the plugin that claims
 * it: `wordpress`, `laravel`, `django-cms`), so a platform plugin's feature drives a site its own builder made, and
 * is skipped where the workspace has none.
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

/** Is a project this platform's? Its type, or the plugin that claims it (`-` and `_` are one, as in the layer). */
const isPlatform = (project, platform) => [project.type, project.platform].some((v) => v && v.replace(/-/g, '_') === platform.replace(/-/g, '_'));

/** The first running site of a runtime (of one platform, when one is named), or why there is none. */
async function runningSite(runtime, platform = '') {
  const sites = sitesOf(runtime).filter((s) => !platform || isPlatform(s.project, platform));
  if (!sites.length) return { why: `the workspace holds no ${platform ? `${platform} ` : ''}site on ${TITLES[runtime]} (build one with --runtime ${runtime})` };
  const projectRuntime = require(path.join(APP, 'project-runtime'));
  projectRuntime.invalidate();
  const states = await projectRuntime.statesFor(sites.map((s) => s.project));
  const site = sites.find((s) => states.get(s.project.root) === 'running');
  if (!site) return { why: `no site on ${TITLES[runtime]} is running (${sites.map((s) => `${s.folder}/${s.name}: ${states.get(s.project.root)}`).join(', ')}); start one` };
  return { site };
}

const NEEDS_RUNTIME = /^@needs-runtime-(docker|podman|kubernetes)$/;
const NEEDS_PLATFORM = /^@needs-platform-([a-z0-9][a-z0-9_-]*)$/;
Before(async function (scenario) {
  const tags = (scenario.pickle.tags || []).map((t) => t.name);
  const platform = (tags.map((t) => NEEDS_PLATFORM.exec(t)).find(Boolean) || [])[1] || '';
  for (const name of tags) {
    const m = NEEDS_RUNTIME.exec(name);
    if (!m) continue;
    const { site, why } = await runningSite(m[1], platform);
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

// A page of the site itself, at the address its row links to: a platform plugin's feature reads the front page or
// the login screen of the site its builder made. The address is read from the row the first time (the folder's
// page is open then) and kept for the scenario, so a second page of the site is opened from the first.
When('I open {string} on the {string} site', async function (pathname, runtime) {
  const site = siteOf(this, runtime);
  if (!this.runtimeSiteAddress) this.runtimeSiteAddress = await rowOf(this, site).locator('a.pcard-host').getAttribute('href', { timeout: 15000 });
  const href = this.runtimeSiteAddress;
  assert.match(pathname, /^\//, 'a path of the site, starting with /');
  const response = await this.page.goto(href.replace(/\/+$/, '') + pathname, { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.status() < 400, `${href}${pathname} answered ${response && response.status()}`);
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

module.exports = { sitesOf, runningSite, isPlatform };

// ---------------------------------------------------------------------------------------------------------------
// The dashboard itself on a plain address (tests/features/runtimes/dashboard.feature): node on a port, the
// Workspace's image on Docker Compose (core/docker) or on Kubernetes (core/k8s).
//
// `@needs-plain-address`: the dashboard is asked on an address that is not the hub or one of its subdomains. On
// the hub the links are the hub's own, so the scenario is skipped with the reason.
const hubName = () => require(path.join(APP, 'workspaces')).hubDomain();
const hereHost = () => new URL(BASE()).host;
Before({ tags: '@needs-plain-address' }, function () {
  const { onHub } = require(path.join(APP, 'urls'));
  if (onHub(hereHost())) {
    this.attach(`SKIPPED: the suite runs against the hub (${hereHost()}), whose links are its own. Against a dashboard on `
      + 'a port, on Docker Compose or on Kubernetes (LAUNCH_URL) this is a real test.');
    return 'skipped';
  }
  return undefined;
});

Then('the footer should name the address of this dashboard', async function () {
  const footer = this.page.locator('footer').first();
  await footer.waitFor({ state: 'visible', timeout: 15000 });
  const text = await footer.innerText();
  assert.ok(text.includes(hereHost()), `the footer says "${text.trim()}", not ${hereHost()}`);
  assert.ok(!text.includes(hubName()), `the footer names the hub ${hubName()}`);
});

Then('no link of the page should lead to the hub', async function () {
  const hub = hubName();
  const leaving = await this.page.locator(`a[href*="//${hub}"], a[href*=".${hub}"], form[action*="${hub}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('href') || e.getAttribute('action')));
  assert.deepStrictEqual(leaving, [], `links that leave ${hereHost()} for the hub`);
});

When('I ask the dashboard under the name {string}', async function (name) {
  // A raw request: a browser cannot send another Host, which is the point of the guard.
  const http = require('http');
  const url = new URL(BASE());
  this.refusal = await new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port || 80, path: '/', headers: { Host: name } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
});

Then('it should refuse with {int}', function (status) {
  assert.strictEqual(this.refusal.status, status, this.refusal.body.slice(0, 200));
  assert.match(this.refusal.body, /does not answer to the name/);
});

When('I keep the preference {string} as {string}', async function (name, value) {
  await this.page.evaluate(([n, v]) => window.wsPrefSet(n, v), [name, value]);
});

Then('the preference {string} should be {string} in the cookies of this address', async function (name, value) {
  const cookies = await this.page.context().cookies(BASE());
  const cookie = cookies.find((c) => c.name === name);
  assert.ok(cookie, `no ${name} cookie on ${hereHost()}: ${cookies.map((c) => c.name).join(', ') || 'none'}`);
  assert.strictEqual(cookie.value, value);
  assert.strictEqual(cookie.domain, new URL(BASE()).hostname, 'the cookie is this address\'s own');
  assert.strictEqual(await this.page.evaluate((n) => window.wsPref(n, ''), name), value);
});

// The palette on a plain address (#759). What it lists is asked of the dashboard under test, not read from this
// checkout: the suite also runs against a dashboard made elsewhere (the image on Docker Compose, a pod).
When('I choose the first workspace folder in the palette', async function () {
  const res = await this.page.request.get(`${BASE()}/fragments/palette.json`);
  const { workspaces } = await res.json();
  if (!workspaces.length) {
    this.attach('SKIPPED: this workspace has no folder yet (a fresh one), so the palette has none to go to. With a folder '
      + '(a workspace plugin activated) this is a real test.');
    return 'skipped';
  }
  const [folder] = workspaces;
  this.paletteFolder = folder;
  await this.page.keyboard.press('Control+k');
  await this.page.waitForSelector('#palette:not([hidden])', { timeout: 5000 });
  await this.page.type('#palette .palette-input', folder.label);
  await this.page.waitForFunction((want) => {
    const chosen = document.querySelector('#palette-list [role=option][aria-selected="true"] .palette-label');
    return !!chosen && chosen.textContent === want;
  }, folder.label, { timeout: 5000 });
  // Enter leaves the page for the entry's address; an address that cannot be reached is an error page, not a wait.
  await Promise.all([
    this.page.waitForEvent('framenavigated', { timeout: 15000 }).catch(() => null),
    this.page.keyboard.press('Enter'),
  ]);
  await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  return undefined;
});

Then('I should be on that folder\'s page of this dashboard', async function () {
  const now = new URL(this.page.url());
  const here = new URL(BASE());
  assert.strictEqual(now.origin, here.origin, `the palette left this dashboard for ${now.href}`);
  assert.strictEqual(now.pathname, `/${this.paletteFolder.key}`, `the palette opened ${now.pathname}`);
});
