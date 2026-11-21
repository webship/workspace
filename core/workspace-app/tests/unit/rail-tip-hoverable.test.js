/**
 * From the accessibility test of this round (WCAG 1.4.13, content on hover or focus): the rail's tooltip had
 * `pointer-events: none` and sat 10px from its tile, and it went as soon as the pointer left the tile, so a
 * magnifier user could never move onto it to read it.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

test('the tooltip can be hovered, across the gap to its tile', () => {
  const css = read('public', 'css', 'components', 'full-height-right-actions-rail-pages-that-have-actions.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/#rail-tip \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /pointer-events:\s*none/);
  assert.match(css, /#rail-tip::after \{ content: ""; position: absolute; top: 0; bottom: 0; left: 100%; width: 0\.75rem; \}/);
});

test('it stays while the pointer is on the tile or on it, and goes a moment after it leaves both', () => {
  const ui = read('public', 'ui.js');
  const body = ui.slice(ui.indexOf('(function railTips() {'), ui.indexOf('// Whether there is more rail below the fold'));
  assert.match(body, /const later = \(\) => \{ clearTimeout\(hideTimer\); hideTimer = setTimeout\(hide, 150\); \};/);
  assert.match(body, /tip\.addEventListener\('mouseenter', keep\);/);
  assert.match(body, /tip\.addEventListener\('mouseleave', \(e\) => \{ if \(!tile\(\{ target: e\.relatedTarget \}\)\) later\(\); \}\);/);
  assert.match(body, /rail\.addEventListener\('mouseout', \(e\) => \{ if \(tile\(e\) && !onTip\(e\.relatedTarget\)\) later\(\); \}\);/);
  assert.match(body, /document\.addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Escape'\) hide\(\); \}\);/, 'Escape still dismisses it');
});
