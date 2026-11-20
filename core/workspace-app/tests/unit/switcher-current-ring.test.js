/**
 * The width switcher beside every page heading and the view switchers above every list said which choice
 * was on by a tint alone: 1.19:1 against the bar in light and 1.04:1 in dark (WCAG 1.4.11 asks 3:1), with
 * an icon colour change of 1.43:1 and 1.06:1. The one that is on now carries a ring in the link colour.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'grid-and-list.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the width and view choice that is on has a ring in the link colour, not only a tint', () => {
  for (const sel of ['view-pick', 'page-width-pick']) {
    assert.match(css, new RegExp(`\\.${sel}\\.is-current[^{]*\\{[^}]*box-shadow:\\s*inset 0 0 0 1px var\\(--link\\)`, 's'), `.${sel}.is-current has no ring`);
  }
});

test('the ring is a shadow, so the focus outline of the choice that is on is left alone', () => {
  for (const m of css.matchAll(/([^{}]*\.(?:view-pick|page-width-pick)\.is-current[^{}]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /outline/, `${m[1].trim()} sets an outline, which would replace the focus ring`);
  }
});

test('in forced colours, where shadows and fills are dropped, the choice that is on has a border', () => {
  const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.ok(forced.length < css.length, 'no forced-colors block');
  assert.match(forced, /\.page-width-pick\.is-current\s*\{\s*border:\s*1px solid CanvasText/);
});
