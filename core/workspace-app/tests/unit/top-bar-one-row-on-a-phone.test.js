/**
 * The top bar is one row on a phone.
 *
 * Round 7 measured it at 191px (three rows) from 320 to 390px wide and 144px at 414 and 480: the logo with its
 * word and the search with its "Ctrl K" hint did not fit beside the other controls, so each group wrapped.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'top-toolbar-logo-breadcrumb.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

/** Every `@media (max-width: <q>) { … }` block of the file, whole. */
function blocks(q) {
  const out = [];
  let i = css.indexOf(`@media (max-width: ${q}) {`);
  while (i >= 0) {
    let depth = 0;
    for (let j = css.indexOf('{', i); j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      if (css[j] === '}') { depth -= 1; if (!depth) { out.push(css.slice(i, j + 1)); break; } }
    }
    i = css.indexOf(`@media (max-width: ${q}) {`, i + 1);
  }
  return out;
}
const phone = blocks('40em').find((b) => b.includes('.toolbar-inner')) || '';
const narrow = blocks('24em').join('\n');

test('below 640px the bar closes up and the key hint goes', () => {
  assert.ok(phone, 'a phone block for the bar');
  assert.match(phone, /\.uk-navbar-container\.toolbar \.toolbar-inner \{ padding: 0 0\.75rem; \}/);
  assert.match(phone, /\.uk-navbar-container\.toolbar \.palette-trigger \.palette-trigger-key \{ display: none; \}/, 'no Ctrl K to show on a phone');
});

test('below 384px the word beside the logo goes, the logo stays', () => {
  assert.match(narrow, /\.uk-navbar-container\.toolbar \.toolbar-product \{ display: none; \}/);
  assert.doesNotMatch(narrow, /brand-logo|toolbar-logo \{[^}]*display:\s*none/, 'the logo itself stays');
});

test('the phone rules outrank the same selectors in files assembled after this one', () => {
  // top-toolbar-logo-breadcrumb comes before layout-rhythm, mic-on-any-field and settings-editor in
  // COMPONENT_ORDER, and those set .toolbar .uk-navbar-item, .toolbar-inner and .toolbar-nav .action-btn.
  const rules = `${phone}\n${narrow}`.match(/(^|\n)\s*\.[^{}@]+\{/g) || [];
  assert.ok(rules.length >= 7, `${rules.length} rules`);
  for (const r of rules) assert.match(r.trim(), /^\.uk-navbar-container\.toolbar /, `${r.trim()} is prefixed`);
});

test('the search keeps its name when its key hint is hidden', () => {
  assert.match(server, /class="uk-navbar-item palette-trigger"[^>]*\n?\s*aria-label="Ctrl K: open the command palette"/);
});
