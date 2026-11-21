/**
 * From the accessibility test of this round (WCAG 1.4.11): the 84 checkboxes of Settings -> Buttons and Dev's
 * "Start AI" kept UIkit's #ccc edge (1.61:1 on white), raised only inside the editor modal; and Dev's Project
 * name field kept --line (1.35:1 light, 1.29:1 dark), its own rule outranking base.css's field edge.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const css = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', ...p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const EDGE = 'color-mix(in srgb, var(--text-subtle) 70%, var(--surface-card))';

test('a checkbox and a radio have a field\'s edge everywhere, not only in the modal', () => {
  assert.ok(css('base.css').includes(`.uk-checkbox,\n.uk-radio { border-color: ${EDGE}; }`));
});

test('the build form\'s fields keep base.css\'s edge colour', () => {
  const rule = css('components', 'mic-on-any-field-that-wants-typing.css').match(/\.build-form \.uk-select,\s*\.build-form \.uk-input \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /border:\s*1px solid var\(--line\)/);
  assert.match(rule, /border-width: 1px;\s*border-style: solid;/);
  assert.doesNotMatch(rule, /border-color/);
});
