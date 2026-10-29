/**
 * Comfortable or compact project rows.
 *
 * A project card carries about a dozen buttons, each with a small caption under it ("36 commands", "linked",
 * "locked"). The research on well-known dashboards (Railway, Render, GitHub Primer, GitLab Pajamas, Linear, the
 * WordPress DataViews) agrees a row should show its actions and fold the notes. Compact does that without
 * hiding an action, and without the choice being made for anybody.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const server = read('server.js');
const ui = read('public/ui.js');
const css = read('public/css/components/density.css');

test('the choice is made before first paint, in the same place as the page width', () => {
  assert.match(server, /d\.dataset\.density=wsPref\('ws-density',null\)==='compact'\?'compact':'comfortable';/);
  assert.ok(!/`/.test(server.split("How dense a project row is")[1].split('</script>')[0]),
    'no backtick in the pre-paint script: it lives inside a template literal');
});

test('the switch sits beside the page width, on pages that list projects only', () => {
  assert.match(server, /function densitySwitcherHtml\(\)/);
  assert.match(server, /\$\{!files && !home \? densitySwitcherHtml\(\) : ''\}/);
  assert.match(server, /class="density-pick" data-density="\$\{esc\(v\)\}"/);
  assert.match(server, /aria-label="How dense the project rows are"/);
});

test('it is a pressed state, remembered like the width, and the caption becomes the tooltip', () => {
  assert.match(ui, /e\.target\.closest\('\.density-pick'\)/);
  assert.match(ui, /wsPrefSet\('ws-density', density\)/);
  assert.match(ui, /for \(const btn of document\.querySelectorAll\('\.density-pick'\)\)/);
  assert.match(ui, /btn\.title = btn\.title \? `\$\{btn\.title\} · \$\{text\}` : text;/);
});

test('compact folds the caption away from sight, not from a screen reader', () => {
  assert.match(css, /html\[data-density="compact"\] \.act-with-status > \.act-status \{/);
  assert.match(css, /clip: rect\(0 0 0 0\); clip-path: inset\(50%\)/);
  assert.ok(!/display:\s*none/.test(css.split('.act-status')[1].split('}')[0]), 'display: none would hide it from assistive technology too');
  assert.match(require('../../themes').assembleCss(''), /\/\* component: density \*\//);
});

test('the palette offers both, through the same preference', () => {
  const js = read('public/palette.js');
  assert.match(js, /label: 'Rows: compact'/);
  assert.match(js, /label: 'Rows: comfortable'/);
  assert.match(js, /window\.wsPrefSet\('ws-density', value\)/);
});
