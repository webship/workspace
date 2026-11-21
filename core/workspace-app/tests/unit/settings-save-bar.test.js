/**
 * The save bar of a settings form. On a page, General's one Save and its "Unsaved changes" sat at the very
 * bottom of a form of 122 fields (about 13,000px), out of view while a field near the top was edited; on a
 * phone the button broke into a three-line pill ("…setti / ngs.yml") once inline code was let wrap at every
 * width (#561), and the placeholder count beside it squeezed it further.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const dir = path.join(__dirname, '..', '..', 'public', 'css', 'components');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the save bar stays in view while a form is edited, and wraps rather than squeezing the button', () => {
  const css = read('settings-editor-core-config-yml.css');
  const bar = css.match(/\.settings-save \{([^}]*)\}/)[1];
  for (const d of ['position: sticky', 'bottom: 0', 'flex-wrap: wrap', 'background: var(--surface-card)', 'border-top: 1px solid var(--line)']) {
    assert.ok(bar.includes(d), `the bar has ${d}`);
  }
  assert.match(css, /@media \(max-width: 59\.9375em\) \{\s*\.settings-save \{ justify-content: flex-end; \}/, 'clear of the assistant\'s button on a phone');
});

test('a button\'s words stay on one line, a file name in it too, also below 640px', () => {
  const css = read('responsive-home-and-the-workspace-pages.css');
  const rule = css.indexOf('.uk-button :is(code, code.fname) { white-space: nowrap; overflow-wrap: normal; }');
  assert.ok(rule > 0, 'no rule for code inside a button');
  assert.ok(rule > css.indexOf(':not(pre) > code { white-space: normal'), 'after the rule that lets code wrap');
  // (0,2,1) beats the phone rule's code.fname (0,1,1) whatever the order.
  assert.match(css, /@media \(max-width: 39\.9375em\) \{\s*:not\(pre\) > code, code\.fname \{ white-space: normal/);
});
