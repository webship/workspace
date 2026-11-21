/**
 * A row menu's long entry wraps instead of losing its end (webship/workspace#688).
 *
 * The row menus are an 18rem column, and each entry was kept on one line and cut with an ellipsis. The DOCKER menu
 * showed "Down and remove volumes (data is l…": the warning, on the one entry that deletes data, was what was cut.
 * An entry that does not fit now wraps onto a second line. Measured in a browser: before, that entry's text was
 * clipped; after, no entry of the menu is, and it takes two lines (54px against 32px).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'ddev-menu.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const at = css.indexOf(`${sel} {`);
  assert.ok(at >= 0, sel);
  return css.slice(at, css.indexOf('}', at));
};

test('an entry wraps when it does not fit, and is never cut', () => {
  const a = rule('.project-row .act-menu .uk-dropdown-nav > li > a');
  assert.match(a, /white-space: normal;/);
  assert.match(a, /overflow-wrap: anywhere;/);
  assert.doesNotMatch(a, /text-overflow|white-space: nowrap|overflow: hidden/);
});

test('the column keeps its width, and the icon its size', () => {
  assert.match(rule('.project-row .act-menu .uk-dropdown'), /width: 18rem;/);
  assert.match(rule('.project-row .act-menu .uk-dropdown-nav > li > a > .uk-icon'), /flex: none;/);
});
