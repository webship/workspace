/**
 * From the accessibility test of this round (WCAG 2.4.11, focus not obscured): with the assistant closed, its
 * round launcher floats over the bottom-left corner, and Tab put focus under it. Walking Tab on the same tree:
 * 4 controls at 390 on /dev, 14 on /settings, 16 at 320x256 (400% zoom), one of them wholly; none after.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'assistant-views.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('what takes focus is scrolled to above the floating launcher, at every width', () => {
  assert.match(css, /\nhtml\.assistant-closed \{ scroll-padding-bottom: 5\.5rem; \}/);
});

test('where the page is one column, it ends clear of the launcher', () => {
  assert.match(css, /@media \(max-width: 59\.9375em\) \{\s*html\.assistant-closed \.app-content \{ padding-bottom: 5\.5rem; \}\s*\}/);
});
