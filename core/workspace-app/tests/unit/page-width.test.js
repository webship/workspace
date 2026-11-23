/**
 * How much of the window a page's content may use.
 *
 * `uk-container-small` capped every page at 900px, which was the right answer while the assistant was
 * a fixed column and the rail was another. Neither is fixed any more, so the cap is a choice — and the
 * two things that can break quietly are the same two as with the assistant's views: it must be applied
 * before first paint (this is the width of the main column; changing it afterwards moves the page), and
 * the setting must be a default rather than an override.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(app, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(app, 'public', 'css', 'components', 'page-width.css'), 'utf8');
const { styleSettings } = require(path.join(app, 'workspaces'));

test('the width is a setting, and a typo falls back rather than rendering nothing', () => {
  assert.ok(['comfortable', 'wide', 'full'].includes(styleSettings().pageWidth));
});

test('it is applied before first paint, and a stored choice wins over the setting', () => {
  const head = server.slice(server.indexOf("var d=document.documentElement"), server.indexOf('</script>'));
  // Read through wsPref: the choice is a cookie on the hub domain, so the page is the same width on
  // every workspace subdomain rather than one width per origin.
  assert.match(head, /wsPref\('ws-page-width',null\)\|\|'\$\{style\.pageWidth\}'/,
    'the setting is the default; the stored choice wins, as with style.mode');
  assert.match(head, /indexOf\(w\)<0\)w='comfortable'/, 'an unknown width must fall back');
  assert.match(head, /d\.dataset\.pageWidth=w/);
});

test('the control sits with the other layout controls, not in the rail', () => {
  // How wide the page may be and how many fit across it are one question; answering it from the rail
  // meant looking away from the thing being changed.
  const fn = server.slice(server.indexOf('function viewSwitcherHtml'), server.indexOf('/* ---------------- pages ---------------- */'));
  assert.match(fn, /class="view-switcher width-switcher"/);
  for (const w of ['comfortable', 'wide', 'full']) {
    assert.match(fn, new RegExp(`\\['${w}',`), `no way to choose ${w}`);
  }
  assert.ok(!/actions-width/.test(server), 'the rail row is gone');
  assert.match(ui, /const pick = \(?e\.target\s*\)?\.closest\s*\('\.page-width-pick'\)/);
  assert.match(ui, /wsPrefSet\('ws-page-width', width\)/, 'and it is remembered for the whole dashboard');
});

test('the cap is beaten on specificity, never with !important', () => {
  // UIKit's own .uk-container-small is a single class in a stylesheet linked after this one, so a
  // single class of ours would lose the tie — the same trap the assistant's New chat button hit.
  // .page-body, not .page-body.uk-container-small: the home page is a `large` container, and the
  // control did nothing at all on the page most worth widening.
  assert.match(css, /html\[data-page-width="wide"\] \.page-body \{ max-width/);
  assert.match(css, /html\[data-page-width="full"\] \.page-body \{ max-width: none; \}/);
  // The comment above those rules says the word; what matters is that no DECLARATION carries it.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/!important/.test(declarations), 'never !important, and never a fork of the vendored CSS');
});

// From the accessibility test of 2026-11-21: in a page's heading the width switcher was first in the markup and
// drawn last (order: 9), so focus met it before the heading's "?" that is drawn before it (WCAG 2.4.3, on six
// pages); and /docs and /images had two, the heading's and the file list's.
test('in a heading the switcher is last in the markup, the "?" goes before it, and a page has one', () => {
  assert.doesNotMatch(server, /page-heading">\$\{(widthSwitcherHtml\(\)|meta\.kind === 'files')/, 'first in a heading again');
  const lasts = server.match(/\n {4}<\/div>\n {4}\$\{(widthSwitcherHtml\(\)|meta\.kind === 'files' \? widthSwitcherHtml\(\) : '')\}\n {2}<\/div>/g) || [];
  assert.strictEqual(lasts.length, 6, 'the six headings with a switcher');
  assert.match(ui, /head\.insertBefore\(a, head\.querySelector\(':scope > \.width-switcher'\)\);/);
  const grid = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'grid-and-list.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(grid, /\.page-heading \.width-switcher \{ margin-left: auto; \}/);
  assert.doesNotMatch(grid, /\.page-heading \.width-switcher \{[^}]*order:/);
  const fn = server.slice(server.indexOf('function viewSwitcherHtml'), server.indexOf('function densitySwitcherHtml'));
  assert.match(fn, /\$\{files \? '' : widthSwitcherHtml\(\)\}/, 'a list of files keeps only the grid choice: its page heading has the width');
});
