/**
 * Keyboard focus that can be seen on buttons and fields, fields with an edge, and focus that is not
 * scrolled under the toolbar (WCAG 2.4.7, 1.4.11, 2.4.11).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', f), 'utf8');
const base = css('base.css');

test('buttons, selects and text fields take a real outline on keyboard focus, after the rules that hid it', () => {
  const at = base.indexOf('.uk-button:focus-visible,\n.uk-select:focus-visible,\n.uk-input:focus-visible,\n.uk-textarea:focus-visible {');
  assert.ok(at > 0);
  const rule = base.slice(at, base.indexOf('}', at));
  assert.match(rule, /outline: 2px solid var\(--link\);/);
  assert.match(rule, /outline-offset: 2px;/);
  assert.ok(at > base.indexOf('.uk-button-primary:focus-visible,'), 'after the white ring for filled buttons, which is invisible on a white page');
});

test('a field has an edge mixed from the style, not the 1.3:1 hairline', () => {
  const input = base.slice(base.indexOf('.uk-input, .uk-textarea {'));
  assert.match(input.slice(0, input.indexOf('}')), /border-color: color-mix\(in srgb, var\(--text-subtle\) 70%, var\(--surface-card\)\);/);
  const select = base.slice(base.indexOf('.uk-select:not([multiple]):not([size]) {'));
  assert.match(select.slice(0, select.indexOf('}')), /border-color: color-mix\(in srgb, var\(--text-subtle\) 70%, var\(--surface-card\)\);/);
});

test('focus is scrolled to below the toolbar, and the toolbar does not stick where it wraps or the window is short', () => {
  assert.match(base, /html \{ scroll-padding-top: 4\.875rem; \}/);
  const bar = css('components/top-toolbar-logo-breadcrumb.css');
  assert.match(bar, /@media \(max-width: 40em\), \(max-height: 30em\) \{\s*\.uk-navbar-container\.toolbar \{ position: static; \}/);
});

test('no later rule takes the outline of a button away again', () => {
  const later = css('components/mic-on-any-field-that-wants-typing.css');
  const at = later.indexOf('.uk-button:focus-visible {');
  const rule = later.slice(at, later.indexOf('}', at));
  assert.match(rule, /outline: 2px solid var\(--link\);/);
  assert.ok(!/outline: 0/.test(rule));
});
