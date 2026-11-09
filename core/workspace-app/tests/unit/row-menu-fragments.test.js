/**
 * The core's row menus load their bodies when they open (#109).
 *
 * A page of fifty project rows carried fifty copies of the DDEV, COMPOSER, Tests and SCREENS menus —
 * about 1.2 MB of dropdowns nobody had opened. Now each row carries the button, its caption and an
 * empty shell (plugin-loader's menuShellHtml, the one the plugins' lazy menus use), and the body comes
 * from /fragments/row-menu/<slot>/<ws>/<project> when the menu opens, computed for that one project.
 *
 * Against a real server over a temp workspace tree: a sites workspace with a DDEV project that has a
 * composer.json and the testing scripts, and a packages workspace with a package that declares checks.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-row-menus-'));
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  // The layout the rows and the fragments arrange by, blank: a machine's own row-actions.yml must not
  // decide what this test sees.
  for (const f of ['row-actions.yml', 'row-actions.seen.json']) fs.rmSync(path.join(root, 'core/config', f), { force: true });
  // A site: DDEV-configured, with a composer.json and the scripts that gate Tests, test users and checks.
  const site = path.join(root, 'dev/site-one');
  fs.mkdirSync(path.join(site, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(site, '.ddev/config.yaml'), 'name: site-one\ntype: drupal\ndocroot: web\n');
  fs.writeFileSync(path.join(site, 'composer.json'), JSON.stringify({ name: 'acme/site-one', require: { 'drupal/core': '^11' }, scripts: { 'post-install-cmd': ['echo hi'], 'site:check': 'echo check' } }));
  fs.writeFileSync(path.join(site, 'composer.lock'), '{}');
  fs.writeFileSync(path.join(site, 'package.json'), JSON.stringify({ name: 'site-one', scripts: { 'lint:js': 'eslint .' } }));
  fs.mkdirSync(path.join(root, 'dev/plain-folder'), { recursive: true });
  for (const f of ['cmd-tools-testing.sh', 'cmd-tools-checks.sh', 'cmd-tools-add-users.sh']) fs.writeFileSync(path.join(root, 'dev', f), '#!/usr/bin/env bash\n');
  // A package: no DDEV, a package.json that declares checks.
  const pkg = path.join(root, 'products/pkg-one');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'pkg-one', scripts: { 'lint:js': 'eslint .', 'lint:css': 'stylelint "**/*.css"' } }));
  fs.writeFileSync(path.join(pkg, 'composer.json'), JSON.stringify({ name: 'acme/pkg-one', type: 'drupal-module' }));
  fs.writeFileSync(path.join(root, 'products', 'cmd-tools-checks.sh'), '#!/usr/bin/env bash\n');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (p) => fetch(base + p);
const text = async (p) => { const r = await get(p); return { status: r.status, html: await r.text() }; };
/** One row's HTML out of a workspace page. */
const rowOf = (html, name, anchor = `"projectName":"${name}"`) => {
  const at = html.indexOf(anchor);
  assert.ok(at > 0, `no row for ${name}`);
  // A row is a card: `<div class="uk-card … project-row pcard">` opens it, the next card ends it.
  const start = html.lastIndexOf('project-row pcard', at);
  const end = html.indexOf('project-row pcard', at);
  return html.slice(start, end < 0 ? undefined : end);
};
/** The menu wrapper of one slot inside a row: the shell and what follows it up to the caption. */
const menuOf = (row, slot) => {
  const m = new RegExp(`<span class="act-with-status"><div class="uk-inline act-menu act-menu-${slot}[^"]*">[\\s\\S]*?</div></div>(<span class="act-status uk-text-meta">[^<]*</span>)?</span>`).exec(row);
  return m ? m[0] : '';
};

test('a project row carries the button, the caption and an empty shell for each core menu, and no menu body', async () => {
  const { status, html } = await text('/dev');
  assert.strictEqual(status, 200);
  const row = rowOf(html, 'site-one');
  for (const slot of ['ddev', 'composer', 'tests', 'screens']) {
    const menu = menuOf(row, slot);
    assert.ok(menu, `${slot}: the row has the menu`);
    assert.match(menu, new RegExp(`hx-get="/fragments/row-menu/${slot}/dev/site-one"`), `${slot}: the shell asks the core route for its body`);
    assert.match(menu, /class="act-menu-lazy[^"]*" hx-get=/, `${slot}: the dropdown is the lazy shell`);
    assert.match(menu, /hx-trigger="menu-opened/, `${slot}: fetched when the menu opens`);
    assert.match(menu, /hx-target="this" hx-swap="innerHTML"/, `${slot}: into the dropdown itself`);
    assert.match(menu, /<ul class="uk-nav uk-dropdown-nav"><li class="uk-nav-header">…<\/li><\/ul>/, `${slot}: a placeholder, not the menu`);
  }
  // The state words stay on the row: DDEV counts its commands, COMPOSER says locked, Tests says what it can do.
  assert.match(menuOf(row, 'ddev'), /<span class="act-status uk-text-meta">\d+ commands<\/span>/, 'the DDEV caption counts the commands the body will hold');
  assert.match(menuOf(row, 'ddev'), /class="act-menu-lazy ddev-dropdown-wide"/, 'the DDEV width class rides on the shell');
  assert.match(menuOf(row, 'composer'), /<span class="act-status uk-text-meta">locked<\/span>/);
  assert.match(menuOf(row, 'composer'), /class="act-menu-lazy composer-dropdown composer-dropdown-wide"/, 'a site workspace installs: the wide, two-column menu');
  assert.match(menuOf(row, 'tests'), /<span class="act-status uk-text-meta">not set up<\/span>/);
  assert.match(menuOf(row, 'tests'), /uk-button-secondary/, 'the Tests button as it was');
  assert.match(menuOf(row, 'screens'), /hx-trigger="menu-opened, load, every 30s, screens-changed from:body"/, 'SCREENS still polls: the hand and the agent badge ride on its answer');
  assert.match(menuOf(row, 'screens'), /<span class="act-status uk-text-meta">none<\/span>/);
  // Nothing of the bodies is on the page.
  for (const inner of ['/actions/ddev-restart', '/actions/ddev-describe', '/actions/composer-install', '/actions/testing-configure', '/actions/checks-plan', 'composer-package', 'checks-sub', 'ddev-nav-columns']) {
    assert.ok(!row.includes(inner), `${inner} is not on the page before a menu opens`);
  }
  // A folder with no DDEV config has the Configure DDEV button and no DDEV menu; no composer.json, no COMPOSER.
  // No DDEV and no backup here, so nothing on the row posts with its name: found by its Configure DDEV link.
  const plain = rowOf(html, 'plain-folder', '/fragments/projects/ddev-config/dev/plain-folder');
  assert.match(plain, /act-ddev-config/);
  assert.ok(!menuOf(plain, 'ddev') && !menuOf(plain, 'composer'));
});

test('the DDEV body for one project holds the verbs the row used to carry, arranged, in the DDEV list', async () => {
  const { status, html } = await text('/fragments/row-menu/ddev/dev/site-one');
  assert.strictEqual(status, 200);
  assert.match(html, /^<ul class="uk-nav uk-dropdown-nav ddev-nav-columns">/, 'the list the DDEV CSS lays out');
  assert.match(html, /<li class="uk-nav-header" data-group="project">site-one<\/li>/);
  for (const verb of ['/actions/ddev-start', '/actions/ddev-restart', '/actions/ddev-describe', '/actions/ddev-logs', '/actions/ddev-mutagen-sync', '/actions/ddev-diagnose', '/fragments/projects/ddev-config/dev/site-one', '/fragments/projects/addons/dev/site-one']) {
    assert.ok(html.includes(`"${verb}"`), `${verb} is in the body`);
  }
  assert.match(html, /hx-vals='\{"workspace":"dev","projectName":"site-one"\}' hx-target="#webship-workspace-output"/, 'the items post for this project into the output');
  assert.match(html, /class="uk-text-danger arm-step" hx-post="\/actions\/ddev-mutagen-reset"[^>]*hx-trigger="confirmed-remove"/, 'the confirm dialog still arms the destructive items');
  assert.match(html, /Canonical URL/);
  // Stopped: the running-only items (xdebug, share, export) are not offered — the state is read for this project.
  assert.ok(!html.includes('/actions/ddev-xdebug-on') && !html.includes('/actions/ddev-share'), 'a stopped project is not offered the running-only verbs');
  // The caption on the row counted what the body holds.
  const page = (await text('/dev')).html;
  const count = Number(/(\d+) commands/.exec(menuOf(rowOf(page, 'site-one'), 'ddev'))[1]);
  assert.strictEqual((html.match(/<a /g) || []).length, count, 'the row counts the commands the body holds');
});

test('the COMPOSER body for a site is the two-column menu with its commands, the package field and the scripts', async () => {
  const { status, html } = await text('/fragments/row-menu/composer/dev/site-one');
  assert.strictEqual(status, 200);
  assert.match(html, /^<div class="composer-columns">/);
  assert.match(html, /Composer · acme\/site-one/);
  assert.match(html, /Runs as ddev composer in this project\./);
  for (const verb of ['/actions/composer-install', '/actions/composer-update', '/actions/composer-validate', '/actions/composer-require']) assert.ok(html.includes(`"${verb}"`), verb);
  assert.match(html, /hx-include="closest \.composer-package"/);
  assert.match(html, /Scripts in composer\.json/);
  assert.match(html, /"script":"site:check"/, 'the custom script from composer.json is offered');
  assert.ok(!html.includes('post-install-cmd'), 'an event hook is not a script to run');
});

test('the Tests body for a site offers the test users, the environment and the nested checks', async () => {
  const { status, html } = await text('/fragments/row-menu/tests/dev/site-one');
  assert.strictEqual(status, 200);
  assert.match(html, /^<ul class="uk-nav uk-dropdown-nav" uk-nav="multiple: true">/);
  assert.match(html, /hx-post="\/actions\/add-users"/);
  assert.match(html, /hx-post="\/actions\/cancel-users"/);
  assert.match(html, /<li class="uk-nav-header" data-group="suite">not set up<\/li>/);
  assert.match(html, /hx-post="\/actions\/testing-configure"[^>]*>[\s\S]*?Set up the testing environment/);
  assert.ok(!html.includes('/actions/testing-run'), 'no stack, nothing to run');
  assert.match(html, /<li class="uk-parent act-menu-checks" data-entry="checks">/);
  assert.match(html, /hx-post="\/actions\/checks-plan"/);
  assert.match(html, /<ul class="uk-nav-sub checks-sub">/);
  assert.match(html, /<span class="checks-alias">js<\/span> <code class="checks-script">lint:js<\/code>/, 'each alias against the script it runs');
});

test('the Tests body for a package is the checks alone, and a plain folder in a site workspace still gets the environment', async () => {
  const pkg = await text('/fragments/row-menu/tests/products/pkg-one');
  assert.strictEqual(pkg.status, 200);
  assert.match(pkg.html, /act-menu-checks/);
  assert.match(pkg.html, /2 declared/);
  assert.match(pkg.html, /<span class="checks-alias">css<\/span>/);
  assert.ok(!pkg.html.includes('/actions/testing-configure') && !pkg.html.includes('/actions/add-users'), 'a packages workspace has no suite and no test users');
  const page = (await text('/products')).html;
  assert.match(menuOf(rowOf(page, 'pkg-one'), 'tests'), /<span class="act-status uk-text-meta">(2 declared|deps missing)<\/span>/, 'the caption says what the package declares');
  const plain = await text('/fragments/row-menu/tests/dev/plain-folder');
  assert.strictEqual(plain.status, 200);
  assert.match(plain.html, /hx-post="\/actions\/testing-configure"/);
});

test('the SCREENS body lists the sessions (none here), the ways to start one, and swaps the row\'s badges out of band', async () => {
  const { status, html } = await text('/fragments/row-menu/screens/dev/site-one');
  assert.strictEqual(status, 200);
  assert.match(html, /^<ul class="uk-nav uk-dropdown-nav">/);
  assert.match(html, /No screens in this project/);
  assert.match(html, /New screen here…/);
  assert.match(html, /Claude Code here…/);
  assert.match(html, /href="\/screens"/);
  assert.match(html, /<span class="screens-hand" id="screens-hand-dev-site-one" hx-swap-oob="true">/, 'the hand on the button');
  assert.match(html, /id="agent-badge-dev-site-one" hx-swap-oob="true"/, 'the agent badge in the title');
  assert.match(html, /id="plugin-badges-dev-site-one" hx-swap-oob="true"/, 'the plugins\' badges');
  // The legacy fragment the old rows polled still answers, with the list's inner HTML.
  const legacy = await text('/fragments/projects/screens/dev/site-one');
  assert.strictEqual(legacy.status, 200);
  assert.match(legacy.html, /^\s*<li class="uk-nav-header">No screens in this project<\/li>/);
});

test('a project that is not there, a menu the row would not draw, and a slot that is not a menu are 404', async () => {
  for (const [p, why] of [
    ['/fragments/row-menu/ddev/dev/no-such-project', 'no such project'],
    ['/fragments/row-menu/ddev/dev/plain-folder', 'not a DDEV project'],
    ['/fragments/row-menu/composer/dev/plain-folder', 'no composer.json'],
    ['/fragments/row-menu/ddev/products/pkg-one', 'a packages workspace has no DDEV'],
    ['/fragments/row-menu/more/dev/site-one', 'More is drawn inline, not served'],
    ['/fragments/row-menu/ddev/nope/site-one', 'no such workspace'],
    ['/fragments/row-menu/ddev/dev/site-one?body=/fragments/p/x/menu', 'a core slot takes no plugin body'],
    ['/fragments/row-menu/x-plugin/dev/site-one', 'a plugin slot nobody registered'],
  ]) {
    const { status, html } = await text(p);
    assert.strictEqual(status, 404, `${p}: ${why}`);
    assert.match(html, /^<ul class="uk-nav uk-dropdown-nav"><li class="uk-nav-header">/, `${p}: answered as a menu line, so the shell shows why`);
  }
});

test('the Buttons settings page learns the lazy menus\' entries without anyone opening one', async () => {
  const { status, html } = await text('/settings/buttons');
  assert.strictEqual(status, 200);
  // Both menus whose bodies load on open are listed with what they hold, learned from the first project
  // that carries them (learnCoreMenus) — the seen record this tree started with was empty.
  assert.match(html, /composer/i);
  // The record is written a moment after it changes (row-layout's flushSeenSoon).
  await new Promise((r) => setTimeout(r, 2500));
  const seen = JSON.parse(fs.readFileSync(path.join(root, 'core/config/row-actions.seen.json'), 'utf8'));
  assert.ok(seen.composer && Object.keys(seen.composer.groups).length > 0, 'COMPOSER has groups on record');
  assert.ok(seen.tests && Object.keys(seen.tests.groups).length > 0, 'Tests has groups on record');
  assert.ok(seen.ddev && Object.keys(seen.ddev.groups).length > 0, 'DDEV is on record from the rows themselves');
});
