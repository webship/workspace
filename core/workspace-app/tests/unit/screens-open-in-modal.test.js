/**
 * Screens open in the modal, over the page one is on.
 *
 * One modal — the one the top bar's Screens button opens (/fragments/screens into #editor-modal-body) —
 * and every way of opening Screens or one session leads to it: a notice's "Open in Screens", "still
 * running … open it", a row's "All screens", the rail's Screens entry. A link to /screens is the
 * opening (ui.js); ?session=<name> puts that session first in the modal. The address itself stays a page.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const vm = require('vm');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');

// ------------------------------------------------------------------ ui.js --

/** screensModalUrl out of ui.js, run against a page at http://localhost:3000. */
function modalUrlFn() {
  const src = ui.match(/function screensModalUrl\(href\) \{[\s\S]*?\n\}\n/);
  assert.ok(src, 'ui.js has screensModalUrl');
  const ctx = { window: { location: { origin: 'http://localhost:3000' } }, URL, encodeURIComponent };
  vm.runInNewContext(`${src[0]}; this.fn = screensModalUrl;`, ctx);
  return ctx.fn;
}

test('a link to /screens opens the Screens modal, and one with a session asks for that session first', () => {
  const url = modalUrlFn();
  assert.equal(url('/screens'), '/fragments/screens');
  assert.equal(url('/screens?session=dev--site--build'), '/fragments/screens?session=dev--site--build');
  assert.equal(url('http://localhost:3000/screens?session=dev--site--build'), '/fragments/screens?session=dev--site--build');
  // A name that is not a session name is not passed on.
  assert.equal(url('/screens?session=../../etc'), '/fragments/screens');
});

test('other addresses are left alone: other pages, a page under /screens, another origin', () => {
  const url = modalUrlFn();
  assert.equal(url('/screens/runs'), '');
  assert.equal(url('/settings'), '');
  assert.equal(url('/terminal/dev--site--build'), '');
  assert.equal(url('https://example.com/screens'), '');
});

test('the click opens the one modal with the same call the tab modal uses, and leaves a new-tab click alone', () => {
  const at = ui.indexOf('function screensModalUrl(href)');
  const handler = ui.slice(at, ui.indexOf('// Short results become a toast at the top.', at));
  assert.match(handler, /window\.htmx\.ajax\('GET', url, \{ target: '#editor-modal-body', swap: 'innerHTML' \}\)/);
  assert.match(handler, /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/);
  assert.match(handler, /a\.target === '_blank'/);
  // The modal's own link to the page is the way to the page.
  assert.match(handler, /a\.hasAttribute\('data-screens-page'\)/);
  // No second modal: nothing here builds one.
  assert.doesNotMatch(handler, /uk-modal|createElement\('dialog'\)/);
});

test('the asked session is kept fresh by one loader, in the modal and on the page', () => {
  assert.match(ui, /function followAskedSession\(box, name\)/);
  assert.match(ui, /#editor-modal-body \.screen-asked-box\[data-asked-session\]/);
  // It stops when its box is gone (the modal closed), and asks again only while the session runs.
  assert.match(ui, /if \(!box\.isConnected\) return;/);
  assert.match(ui, /if \(box\.querySelector\('\.is-running'\)\) setTimeout\(load, 3000\)/);
});

test('a click inside the Screens modal is not cancelled by the column buttons', () => {
  // The modal wears data-screens-cols for its width: a handler that matched it cancelled every click
  // inside the modal, and the link to the Screens page went nowhere.
  // (\s* and the bracket where the part's TypeScript has a type, which ui.js holds as blank space.)
  assert.match(ui, /e\.target\s*\)?\.closest\s*\('button\[data-screens-cols\]'\)/);
  assert.doesNotMatch(ui, /e\.target\s*\)?\.closest\s*\('\[data-screens-cols\]'\)/);
});

// ------------------------------------------------------------ the notices --

test('"still running … open it" and "open the output" lead to Screens, not to a terminal in a new tab', () => {
  const { terminalLink } = require('../../actions/composer');
  const html = terminalLink('dev--site--composer-update', 'open it');
  assert.equal(html, '<a href="/screens?session=dev--site--composer-update">open it</a>');
  assert.doesNotMatch(html, /target="_blank"|\/terminal\//);
});

test('the notice a command starts with links to the address of its session', () => {
  const { screenStartedHtml } = require('../../jobs');
  const started = screenStartedHtml({ ok: true, session: 'dev--site--build' }, 'build', 'site');
  assert.match(started, /<a href="\/screens\?session=dev--site--build">Open in Screens<\/a>/);
  const already = screenStartedHtml({ ok: false, already: true, session: 'dev--site--build' }, 'build', 'site');
  assert.match(already, /already running[\s\S]*<a href="\/screens\?session=dev--site--build">Open in Screens<\/a>/);
});

// ------------------------------------------------------------ the fragment --

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-screens-modal-'));
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
  // A session that has ended and left its log: what a short command looks like a moment later.
  fs.mkdirSync(path.join(root, '.screens'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screens', 'dev--site--describe.log'), 'first line\nthe last line of the log\n');
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_DIR: path.join(root, 'no-plugins'), WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

const text = async (p) => { const r = await fetch(base + p); return { status: r.status, html: await r.text() }; };

test('/fragments/screens?session=<name>: that session first, its log readable though it has ended, then the sessions', async () => {
  const { status, html } = await text('/fragments/screens?session=dev--site--describe');
  assert.equal(status, 200);
  const box = html.indexOf('class="screen-asked-box" data-asked-session="dev--site--describe"');
  const grid = html.indexOf('id="webship-workspace-projects"');
  assert.ok(box > 0 && grid > box, 'the asked session is drawn before the list of sessions');
  assert.ok(html.indexOf('<h3') < box, 'under the heading the dialog is named after');
  assert.match(html, /screen-asked is-ended/);
  assert.match(html, /the last line of the log/);
});

test('/fragments/screens without a session, or with a name that is not one, is the plain list', async () => {
  for (const p of ['/fragments/screens', '/fragments/screens?session=..%2F..%2Fetc', '/fragments/screens?session=']) {
    const { status, html } = await text(p);
    assert.equal(status, 200, p);
    assert.doesNotMatch(html, /screen-asked-box/, p);
    assert.match(html, /id="webship-workspace-projects"/, p);
  }
});

test('the modal says where the page is, with a link that is not turned back into the modal', async () => {
  const { html } = await text('/fragments/screens');
  assert.match(html, /<a href="\/screens" data-screens-page>the Screens page<\/a>/);
});

test('/screens?session=<name> is still an address: the page, which shows that session first', async () => {
  const { status, html } = await text('/screens?session=dev--site--describe');
  assert.equal(status, 200);
  assert.match(html, /<title>[^<]*Screens/);
  assert.match(ui, /if \(window\.location\.pathname !== '\/screens'\) return;/);
  const asked = await text('/fragments/screen-asked/dev--site--describe');
  assert.match(asked.html, /the last line of the log/);
});

test('the top bar button and a link open the same fragment into the same modal', async () => {
  const { html } = await text('/');
  assert.match(html, /hx-get="\/fragments\/screens" hx-target="#editor-modal-body"/);
  assert.equal((html.match(/id="editor-modal"/g) || []).length, 1);
});
