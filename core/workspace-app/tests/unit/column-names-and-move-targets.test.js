/**
 * Round 7, axe 4.14: the Screens column buttons are named by the number they show (2.5.3), and the item move
 * arrows in Settings → Buttons are at least 24×24 (2.5.8).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const screens = fs.readFileSync(path.join(APP, 'screens.js'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'settings-editor-core-config-yml.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('a column button\'s name holds the number it shows', () => {
  assert.match(screens, /aria-label="\$\{esc\(n === '1' \? title : `\$\{n\} across`\)\}"/);
  // What it shows: the number beside the grid icon, and the list icon alone for one.
  assert.match(screens, /n === '1' \? '<span uk-icon="icon: list; ratio: \.7"><\/span>' : `<span uk-icon="icon: \$\{icon\}; ratio: \.7"><\/span> \$\{n\}`/);
});

test('the item move arrows are at least 24 by 24', () => {
  const rule = css.match(/\.row-entry-item > \.ws-move \.uk-button \{([^}]*)\}/);
  assert.ok(rule, 'the rule is there');
  assert.match(rule[1], /min-width: 1\.5rem;/);
  assert.match(rule[1], /min-height: 1\.5rem;/);
  assert.doesNotMatch(rule[1], /min-height: 0/);
});
