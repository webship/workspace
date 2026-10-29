/**
 * Grid or list, on the home page and inside a workspace.
 *
 * Two different questions wearing one control: a workspace card is small and four fit across, while a
 * project row carries a dozen buttons — so a workspace opens as a LIST and the home page as a grid.
 * What is checked here is what would break quietly: the layout must be decided before first paint, the
 * choice must be the same on every workspace subdomain, and UIKit's utility classes must not be the
 * thing holding the layout, since those carry !important and cannot be overridden.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const app = path.join(__dirname, '..', '..');
const server = fs.readFileSync(path.join(app, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(app, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(app, 'public', 'css', 'components', 'grid-and-list.css'), 'utf8');

test('the layout is applied before first paint, from the shared preference', () => {
  const head = server.slice(server.indexOf("var hv=wsPref('ws-home-view'"), server.indexOf('})();</script>'));
  assert.match(head, /wsPref\('ws-home-view','grid-4'\)/, 'the home page keeps the four-across it has');
  assert.match(head, /wsPref\('ws-rows-view','list'\)/, 'a workspace opens as a list');
  assert.match(head, /indexOf\(hv\)<0\)hv='grid-4'/, 'an unknown value falls back rather than rendering nothing');
  assert.match(head, /indexOf\(rv\)<0\)rv='list'/);
  assert.match(head, /d\.dataset\.homeView=hv/);
  assert.match(head, /d\.dataset\.rowsView=rv/);
});

test('the two lists offer the counts that suit what they hold', () => {
  const fn = server.slice(server.indexOf('function viewSwitcherHtml'), server.indexOf('/* ---------------- pages ---------------- */'));
  for (const v of ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6']) {
    assert.match(fn, new RegExp(`'${v}'`), `home: no ${v}`);
  }
  // Four across is a home-page answer only: three project rows are already tight.
  const rowsPart = fn.slice(fn.indexOf(': [['));
  assert.ok(!/grid-4/.test(rowsPart), 'a workspace must not offer four across');
  assert.match(fn, /aria-label="\$\{esc\(v === 'list' \?/, 'each button says what it does');
  // The icon is the answer, drawn to Tabler's rules — the set every workspace icon already comes from,
  // which ships columns-1/2/3 and nothing past it and nothing for a page width.
  assert.match(server, /const ICON_FRAME = '<rect x="3" y="3" width="18" height="18" rx="2" \/>'/,
    "Tabler's own frame, the one columns-2 and columns-3 are built on");
  assert.match(server, /stroke-width="1\.9" stroke-linecap="round" stroke-linejoin="round"/,
    'a stroked outline like the sprite, not a filled blob');
  assert.match(server, /function viewIcon\(view\)/);
  assert.match(server, /Array\.from\(\{ length: n - 1 \}/,
    'N columns are N-1 dividers, drawn from the count rather than picked from a set');
  assert.match(server, /function widthIcon\(width\)/);
});

test('a choice is remembered for the whole dashboard, not one workspace', () => {
  assert.match(ui, /wsPrefSet\(btn\.dataset\.pref, btn\.dataset\.view\)/,
    'through the hub-domain cookie, like the theme');
  assert.match(ui, /allowed\.includes\(btn\.dataset\.view\)/, 'and only a value we render');
  // The rows arrive in fragments, so the marking has to be redone after a swap.
  assert.match(ui, /document\.addEventListener\('htmx:after:settle', markCurrentViews\)/);
});

test('the card does not depend on UIKit utilities for its layout', () => {
  // uk-text-center and uk-display-block are utilities and carry !important: with them on the card the
  // list view could not turn it into a row at all.
  const card = server.slice(server.indexOf('class="uk-card uk-card-default uk-card-hover'), server.indexOf('class="uk-card uk-card-default uk-card-hover') + 200);
  assert.ok(!/uk-text-center|uk-display-block/.test(card), 'those belong in the stylesheet now');
  assert.match(css, /\.workspace-card \{ display: block; text-align: center; \}/, 'and here is what they did');
});

test('the grids collapse where a column would be a sliver', () => {
  assert.match(css, /@media \(max-width: 63\.99em\)/);
  const narrow = css.slice(css.indexOf('@media (max-width: 63.99em)'));
  assert.match(narrow, /html\[data-rows-view="grid-3"\] #webship-workspace-projects \{ grid-template-columns: 1fr; \}/);
});


test('the width control is on every page, exactly once', () => {
  // It used to be a row in the rail, which every page has. Moved beside the grid control, it has to
  // reach the pages that have no grid control — and must not appear twice on the ones that do.
  assert.match(server, /function widthSwitcherHtml\(\)/);
  const heads = (server.match(/page-heading">\$\{widthSwitcherHtml\(\)\}/g) || []).length;
  assert.ok(heads >= 4, `only ${heads} page headings carry it`);
  // A workspace of projects carries it beside its rows, so its heading must not repeat it — and a
  // workspace of FILES has no such row, so there the heading is where it goes.
  assert.match(server, /\$\{meta\.kind === 'files' \? widthSwitcherHtml\(\) : ''\}/,
    'the workspace page decides by kind, or it is either missing or doubled');
});

test('the list is separated from the Build form, not flush against it', () => {
  // Measured before the fix: on /dev, /test and /projects the form's last control and "Projects · how
  // to lay them out" touched at ZERO pixels, so one question ran straight into the next. A rule as well
  // as the space, because they are two different things to do rather than one thing with a gap in it.
  const rule = css.slice(css.indexOf('.build-form + #webship-workspace-projects'));
  assert.ok(css.includes('.build-form + #webship-workspace-projects'), 'the pairing is what is spaced');
  assert.match(rule, /margin-top: 1\.75rem;/);
  assert.match(rule, /padding-top: 1\.5rem;/);
  assert.match(rule, /border-top: 1px solid var\(--line\);/, 'the hairline every card here uses');
});

test('a workspace with no Build form is not given a rule to nothing', () => {
  // A files workspace has no form above the list, so the pairing simply does not match there —
  // which is the point of spacing the RELATIONSHIP rather than the element.
  assert.ok(!/^#webship-workspace-projects \{[^}]*border-top/m.test(css),
    'the wrapper itself carries no border of its own');
});
