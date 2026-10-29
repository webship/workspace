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
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-palette-root-'));
process.env.WORKSPACE_ROOT = root;
const { buildIndex, PAGES } = require('../../palette-index');

before(() => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'dev/site-one/.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dev/site-one/.ddev/config.yaml'), 'name: site-one\n');
  fs.mkdirSync(path.join(root, 'dev/plain-folder'), { recursive: true });
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
  assert.deepStrictEqual(names, ['plain-folder', 'site-one'], 'folders only: no file, no hidden folder');
  const site = idx.projects.find((p) => p.name === 'site-one');
  assert.strictEqual(site.ddev, true);
  assert.match(site.url, /^https:\/\/site-one\.dev\./, 'a DDEV project opens its site');
  assert.match(idx.projects.find((p) => p.name === 'plain-folder').url, /^https:\/\/dev\.[^/]+\/$/, 'a folder opens its workspace');
  assert.ok(!idx.projects.some((p) => p.ws === 'videos'), 'a files workspace has no projects to list');
});

test('it opens on Ctrl or Cmd + K and "/", the sheet on "?", and chords on "g" then a letter', () => {
  const js = read('public/palette.js');
  assert.match(js, /\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.shiftKey && k\.toLowerCase\(\) === 'k'/);
  assert.match(js, /if \(k === '\/'\) \{ e\.preventDefault\(\); open\(''\); return; \}/);
  assert.match(js, /if \(k === '\?'\) \{ e\.preventDefault\(\); open\('\?'\); return; \}/);
  assert.match(js, /if \(k === 'g'\) \{ chord = Date\.now\(\); \}/);
  assert.match(js, /Date\.now\(\) - chord < 1200/, 'the second key has to come within a moment');
});

test('it never fires while somebody is typing, or while a modal is open', () => {
  const js = read('public/palette.js');
  assert.match(js, /n === 'input' \|\| n === 'textarea' \|\| n === 'select' \|\| t\.isContentEditable/);
  assert.match(js, /\.ace_editor, \.xterm/, 'an editor and a terminal are somewhere to type');
  assert.match(js, /if \(typing\(e\.target\) \|\| modalOpen\(\)\) return;/);
});

test('it is a dialog with a combobox and a listbox, announces its results, and holds the page behind it inert', () => {
  const js = read('public/palette.js');
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
  assert.match(server, /aria-label="Open the command palette" aria-keyshortcuts="Control\+K Meta\+K"/);
  assert.match(read('public/palette.js'), /closest\('\.palette-trigger'\)/);
  assert.match(read('public/palette.js'), /k\.textContent = '⌘K'/);
});

test('letters-in-order matches are a fallback, not noise next to real matches', () => {
  assert.match(read('public/palette.js'), /out\.some\(function \(x\) \{ return x\.score >= 40; \}\)\) out = out\.filter\(function \(x\) \{ return x\.score >= 40; \}\)/);
});
