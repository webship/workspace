/**
 * The command palette, the shortcut sheet and the go-to chords.
 *
 * Nothing in the dashboard answered a keyboard: every move was a pointer to a card or a menu. Ctrl or Cmd + K
 * (and "/") opens one list of workspaces, pages, projects and a few actions; "?" is the sheet; "g" then a letter
 * goes to a workspace. None of it fires while somebody types in a field, and the page behind is out of reach
 * while the palette is open.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
// palette.js is built from src/browser/palette.ts (npm run build:browser): the checks of its code read the source.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-palette-root-'));
process.env.WORKSPACE_ROOT = root;
const { buildIndex, paletteIndex, PAGES } = require('../../palette-index');
const { withRequest } = require('../../urls');

/** The index as a request on that address is answered: the hub or one of its subdomains, or a plain address. */
const indexOn = (host, make = buildIndex) => withRequest({ headers: { host } }, () => make());
const PLAIN = '127.0.0.1:3999';
/** A project on a runtime: the compose file a builder's `--runtime` leaves, with its x-webship block. */
const composeFile = (name, port) => `name: ${name}\nx-webship:\n  runtime: docker\n  stack: php\n  type: php\n${port ? `  port: ${port}\n` : ''}services:\n  web:\n    image: nginx:alpine\n`;

before(() => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'dev/site-one/.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/site-one/.ddev/config.yaml'), 'name: site-one\n');
  fs.mkdirSync(path.join(root, 'dev/plain-folder'), { recursive: true });
  // A folder whose DDEV name is not its own: the canonical address is the name's, the hub's is the folder's.
  fs.mkdirSync(path.join(root, 'dev/renamed/.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/renamed/.ddev/config.yaml'), 'name: shop\n');
  // Sites on another runtime: one with its port, one whose address is not known (no port).
  fs.mkdirSync(path.join(root, 'dev/on-compose'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/on-compose/compose.yaml'), composeFile('on-compose', 18080));
  fs.mkdirSync(path.join(root, 'dev/no-port'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/no-port/compose.yaml'), composeFile('no-port', ''));
  // Both a runtime's block and a .ddev/ of its own: a DDEV project, as on its row.
  fs.mkdirSync(path.join(root, 'dev/both/.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/both/.ddev/config.yaml'), 'name: both\n');
  fs.writeFileSync(path.join(root, 'dev/both/compose.yaml'), composeFile('both', 18081));
  fs.mkdirSync(path.join(root, 'dev/.hidden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/a-file.md'), 'x');
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('the index lists workspaces, the pages, and the project folders of workspaces that hold projects', () => {
  const idx = buildIndex();
  assert.ok(idx.workspaces.some((w) => w.key === 'dev' && /^https:\/\/dev\./.test(w.url)));
  assert.deepStrictEqual(idx.pages.map((p) => p.url), PAGES.map((p) => p.url));
  const names = idx.projects.filter((p) => p.ws === 'dev').map((p) => p.name).sort();
  assert.deepStrictEqual(names, ['both', 'no-port', 'on-compose', 'plain-folder', 'renamed', 'site-one'], 'folders only: no file, no hidden folder');
  const site = idx.projects.find((p) => p.name === 'site-one');
  assert.strictEqual(site.ddev, true);
  assert.match(site.url, /^https:\/\/site-one\.dev\./, 'a DDEV project opens its site');
  assert.match(idx.projects.find((p) => p.name === 'plain-folder').url, /^https:\/\/dev\.[^/]+\/$/, 'a folder opens its workspace');
  assert.ok(!idx.projects.some((p) => p.ws === 'videos'), 'a files workspace has no projects to list');
});

// ---- an entry leads where the page it is drawn on can follow it (#759) ----

const byName = (idx) => Object.fromEntries(idx.projects.map((p) => [p.name, p]));

test('on the hub a workspace is its subdomain and a DDEV project the hub\'s address for it, as before', () => {
  for (const host of ['workspace.ddev.site', 'dev.workspace.ddev.site', 'workspace.ddev.site:8443']) {
    const idx = indexOn(host);
    assert.strictEqual(idx.workspaces.find((w) => w.key === 'dev').url, 'https://dev.workspace.ddev.site/', host);
    const p = byName(idx);
    assert.deepStrictEqual([p['site-one'].url, p['site-one'].ddev, p['site-one'].site], ['https://site-one.dev.workspace.ddev.site/', true, true], host);
    assert.strictEqual(p.renamed.url, 'https://renamed.dev.workspace.ddev.site/', 'by its folder, as its row\'s Launch');
    assert.deepStrictEqual([p['plain-folder'].url, p['plain-folder'].site], ['https://dev.workspace.ddev.site/', false], host);
  }
  assert.deepStrictEqual(buildIndex(), indexOn('workspace.ddev.site'), 'outside a request (the command line) it is the hub\'s');
});

test('on a plain address a workspace is a path of this dashboard, and nothing leads to the hub', () => {
  for (const host of [PLAIN, 'localhost:3000', '10.0.0.7:30080', 'ws.example.org']) {
    const idx = indexOn(host);
    assert.strictEqual(idx.workspaces.find((w) => w.key === 'dev').url, '/dev', host);
    for (const w of idx.workspaces) assert.strictEqual(w.url, `/${w.key}`, `${host}: ${w.key}`);
    assert.ok(!JSON.stringify(idx).includes('workspace.ddev.site'), `${host}: an entry leads to the hub`);
    assert.deepStrictEqual(idx.pages.map((p) => p.url), PAGES.map((p) => p.url), 'the pages are paths on both');
  }
});

test('on a plain address a DDEV project opens its canonical address: the hub\'s own for it is not there', () => {
  const p = byName(indexOn(PLAIN));
  assert.deepStrictEqual([p['site-one'].url, p['site-one'].ddev, p['site-one'].site], ['https://site-one.ddev.site/', true, true]);
  assert.strictEqual(p.renamed.url, 'https://shop.ddev.site/', 'by its DDEV name, as its row\'s address');
});

test('a project on another runtime opens its own address on either, and says so; without one it opens its workspace', () => {
  for (const host of [PLAIN, 'workspace.ddev.site']) {
    const p = byName(indexOn(host));
    assert.deepStrictEqual([p['on-compose'].url, p['on-compose'].ddev, p['on-compose'].site], ['http://127.0.0.1:18080', false, true], host);
    assert.strictEqual(p['no-port'].site, false, `${host}: no address to open yet`);
    assert.deepStrictEqual([p.both.ddev, p.both.site], [true, true], 'a .ddev/ of its own makes it a DDEV project, as on its row');
  }
  const plain = byName(indexOn(PLAIN));
  assert.strictEqual(plain['no-port'].url, '/dev');
  assert.strictEqual(plain['plain-folder'].url, '/dev', 'a folder opens its workspace, on this address');
  assert.strictEqual(plain.both.url, 'https://both.ddev.site/');
  assert.strictEqual(byName(indexOn('workspace.ddev.site'))['no-port'].url, 'https://dev.workspace.ddev.site/');
});

test('what is on disk is kept for a moment, the addresses are not: two addresses get each their own', () => {
  const hub = indexOn('workspace.ddev.site', paletteIndex);
  const plain = indexOn(PLAIN, paletteIndex);
  assert.strictEqual(hub.workspaces.find((w) => w.key === 'dev').url, 'https://dev.workspace.ddev.site/');
  assert.strictEqual(plain.workspaces.find((w) => w.key === 'dev').url, '/dev', 'not the answer kept from the hub\'s request');
  assert.strictEqual(indexOn('workspace.ddev.site', paletteIndex).workspaces.find((w) => w.key === 'dev').url, 'https://dev.workspace.ddev.site/');
  assert.deepStrictEqual(plain.projects.map((p) => p.name), hub.projects.map((p) => p.name), 'the same folders, read once');
});

test('the hint of an entry says what it opens: the site when it has one, else the workspace', () => {
  const js = read('src/browser/palette.ts');
  assert.match(js, /hint: p\.ws \+ \(p\.site \? ' · open the site' : ' · open the workspace'\)/);
  assert.doesNotMatch(js, /p\.ddev \?/, 'not by DDEV alone: a site on another runtime is a site');
});

// The route itself, from a running dashboard asked on each address.
let proc;
let port = 0;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
/** GET a path with the Host a browser on that address would send. */
const ask = (pathname, host) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: pathname, headers: { Host: host } }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  port = await free();
  const env = { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  for (const k of ['WORKSPACE_PATH', 'WORKSPACE_SCRIPTS', 'WORKSPACE_CONFIG', 'IS_DDEV_PROJECT', 'WORKSPACE_LISTEN', 'WORKSPACE_ALLOWED_HOSTS']) delete env[k];
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});
after(() => { if (proc) proc.kill(); });

test('the dashboard answers /fragments/palette.json with the addresses of the address it was asked on', async () => {
  const plain = await ask('/fragments/palette.json', `127.0.0.1:${port}`);
  assert.strictEqual(plain.status, 200);
  const onPlain = JSON.parse(plain.text);
  assert.strictEqual(onPlain.workspaces.find((w) => w.key === 'dev').url, '/dev');
  assert.strictEqual(byName(onPlain)['on-compose'].url, 'http://127.0.0.1:18080');
  assert.strictEqual(byName(onPlain)['site-one'].url, 'https://site-one.ddev.site/');
  assert.ok(!plain.text.includes('workspace.ddev.site'), 'nothing in it leads to the hub');
  const hub = await ask('/fragments/palette.json', 'workspace.ddev.site');
  assert.strictEqual(hub.status, 200);
  const onHub = JSON.parse(hub.text);
  assert.strictEqual(onHub.workspaces.find((w) => w.key === 'dev').url, 'https://dev.workspace.ddev.site/');
  assert.strictEqual(byName(onHub)['site-one'].url, 'https://site-one.dev.workspace.ddev.site/');
  assert.strictEqual(byName(onHub)['on-compose'].url, 'http://127.0.0.1:18080');
});

test('it opens on Ctrl or Cmd + K and "/", the sheet on "?", and chords on "g" then a letter', () => {
  const js = read('src/browser/palette.ts');
  assert.match(js, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && k\.toLowerCase\(\) === 'k'/);
  assert.match(js, /if \(k === '\/'\) \{ e\.preventDefault\(\); open\(''\); return; \}/);
  assert.match(js, /if \(k === '\?'\) \{ e\.preventDefault\(\); open\('\?'\); return; \}/);
  assert.match(js, /if \(k === 'g'\) \{ chord = Date\.now\(\); \}/);
  assert.match(js, /Date\.now\(\) - chord < 1200/, 'the second key has to come within a moment');
});

test('it never fires while somebody is typing, or while a modal is open', () => {
  const js = read('src/browser/palette.ts');
  // (The element the key went to, a field inside a web component included: palette-keys-in-a-component-field.test.js, #671.)
  assert.match(js, /n === 'input' \|\| n === 'textarea' \|\| n === 'select' \|\| n === 'deep-chat' \|\| t\.isContentEditable/);
  assert.match(js, /\.ace_editor, \.xterm/, 'an editor and a terminal are somewhere to type');
  assert.match(js, /if \(typing\(e\) \|\| modalOpen\(\)\) return;/);
});

test('it is a dialog with a combobox and a listbox, announces its results, and holds the page behind it inert', () => {
  const js = read('src/browser/palette.ts');
  assert.match(js, /role="dialog" aria-modal="true" aria-label="Command palette"/);
  assert.match(js, /role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"/);
  assert.match(js, /role="listbox" aria-label="Results"/);
  assert.match(js, /setAttribute\('role', 'option'\)/);
  assert.match(js, /aria-activedescendant/);
  assert.match(js, /aria-live="polite"/);
  assert.match(js, /el\.inert = true/);
  assert.match(js, /returnTo\.focus\(\)/, 'focus goes back to where it was');
});

test('it is served on every page, from one small JSON route', () => {
  const server = read('server.js');
  assert.match(server, /<script src="\$\{assetUrl\('\/palette\.js'\)\}" defer><\/script>/);
  assert.match(server, /pathname === '\/fragments\/palette\.json'/);
  assert.match(server, /'Cache-Control': 'no-store'/);
});

test('the stylesheet is a component with a visible selected row and honours reduced motion', () => {
  const css = read('public/css/components/command-palette.css');
  assert.match(css, /\.palette-row\[aria-selected="true"\] \{ background: var\(--subtle-brand\);/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /#palette\[hidden\] \{ display: none; \}/);
  assert.match(require('../../themes').assembleCss(''), /\/\* component: command-palette \*\//);
});

test('there is a visible way in: a toolbar button that says what key opens it', () => {
  const server = read('server.js');
  assert.match(server, /class="uk-navbar-item palette-trigger" type="button"/);
  // The name starts with what is printed on the button (WCAG 2.5.3): "Ctrl K".
  assert.match(server, /aria-label="Ctrl K: open the command palette" aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(read('src/browser/palette.ts'), /closest\('\.palette-trigger'\)/);
  assert.match(read('src/browser/palette.ts'), /k\.textContent = '⌘K'/);
});

test('letters-in-order matches are a fallback, not noise next to real matches', () => {
  assert.match(read('src/browser/palette.ts'), /out\.some\(function \(x\) \{ return x\.score >= 40; \}\)\) out = out\.filter\(function \(x\) \{ return x\.score >= 40; \}\)/);
});
