/**
 * Inline code kept UIkit's one line at desktop widths: a workspace kept under a long path ("No docs here
 * yet. Put them in /home/<you>/…/docs") ran /docs and the AI folders to 1584px at 1440, so the whole
 * page scrolled sideways. It was let go only below 960px.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'responsive-home-and-the-workspace-pages.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('inline code breaks where it must at every width, not only below 960px', () => {
  // At the top level of the file: the line starts with the selector, not indented inside a media query.
  assert.match(css, /^:not\(pre\) > code \{ white-space: normal; overflow-wrap: anywhere; \}$/m, 'no top-level rule');
  assert.doesNotMatch(css, /@media \(max-width: 59\.9375em\) \{\s*:not\(pre\) > code \{/, 'the 960px-only rule is gone');
});

test('a block of code is left alone: it keeps its lines and scrolls in its own box', () => {
  assert.doesNotMatch(css, /(^|[\s,}])pre(\s*>\s*code)?\s*\{[^}]*white-space:\s*normal/, 'pre must keep its lines');
});
