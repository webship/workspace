/**
 * From the accessibility test of 2026-11-21, two leftovers:
 * - a list pager's steps were named by their glyph ("‹"), and one that could not act was a <span> hidden from
 *   screen readers with a `disabled` a span does not have, faded to 2.31:1;
 * - in forced colours the chosen tab of the Settings modal was told only by its weight.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const { listPagerHtml } = require('../../lists');

test('a pager step is named by what it does, and one that cannot act is a disabled button', () => {
  const html = listPagerHtml('/fragments/dev/projects', '#x', { total: 30, pages: 3, page: 1, from: 1, to: 10 }, { per: 10 }, 'projects');
  for (const t of ['First page', 'Previous page']) {
    assert.ok(html.includes(`<button type="button" class="uk-button uk-button-default uk-button-small" title="${t}" aria-label="${t}" disabled>`), `${t} is not a disabled button`);
  }
  for (const t of ['Next page', 'Last page']) {
    assert.ok(html.includes(`title="${t}" aria-label="${t}"`), `${t} is named by its glyph`);
  }
  assert.doesNotMatch(html, /<span class="uk-button[^"]*" aria-hidden="true" disabled>/);
});

test('in forced colours the chosen Settings tab has a bar in the highlight colour', () => {
  const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'tab-modal.css'), 'utf8');
  assert.match(css, /@media \(forced-colors: active\) \{\s*\.tabmodal-tab\.is-selected \{ box-shadow: none; border-inline-start: 0\.25rem solid Highlight; \}\s*\}/);
});
