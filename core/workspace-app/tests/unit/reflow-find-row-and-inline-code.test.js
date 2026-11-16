/**
 * Reflow (round 7): no page scrolls sideways at 320px because of the find row, and inline code wraps below 960px.
 *
 * At 320px every list page scrolled 12px sideways: the find row's phone rule (.lc-find wraps) lost to
 * `.lc-group { flex-wrap: nowrap }`, assembled later with the same specificity. /graphs scrolled at 768px and at
 * 200% zoom because inline code wrapped only below 640px.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'public', 'css', 'components');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const responsive = read('responsive-home-and-the-workspace-pages.css');
const bar = read('short-results-as-a-toast-at-the-top.css');
const spec = (sel) => (sel.match(/\.[a-z0-9_-]+/gi) || []).length;

test('on a phone the find row wraps, and its rule outranks the bar\'s nowrap', () => {
  const phone = responsive.slice(responsive.indexOf('@media (max-width: 47.9375em) {'));
  const m = phone.match(/([^{}\n]+)\{ flex-wrap: wrap; row-gap: 0\.375rem; \}/);
  assert.ok(m, 'the find row wraps on a phone');
  const nowrap = bar.match(/\n(\.lc-group) \{[^}]*flex-wrap: nowrap;/);
  assert.ok(nowrap, 'the bar keeps a group on one line by default');
  assert.ok(spec(m[1]) > spec(nowrap[1]), `${m[1].trim()} outranks ${nowrap[1]} (the bar's file is assembled later)`);
});

test('inline code wraps below 960px, a block of code is left alone', () => {
  const tablet = responsive.slice(responsive.indexOf('@media (max-width: 59.9375em) {\n  :not(pre) > code'));
  assert.match(tablet, /^@media \(max-width: 59\.9375em\) \{\n  :not\(pre\) > code \{ white-space: normal; overflow-wrap: anywhere; \}\n\}/);
  assert.ok(!/(^|[\s,])pre code/.test(tablet.slice(0, tablet.indexOf('}\n}') + 3)), 'no rule here touches code inside pre');
});
