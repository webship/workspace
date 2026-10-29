/**
 * How a terminal looks: the Ubuntu face and palette by default, a larger text size, and a style
 * the user can change the way the dashboard's own style is changed.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const client = fs.readFileSync(path.join(PUBLIC, 'terminal.js'), 'utf8');
const base = fs.readFileSync(path.join(PUBLIC, 'css/base.css'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'css/components/terminals.css'), 'utf8');
const { TERM_STYLES, termPaneHtml } = require('../../screens.js');

test('the face is Ubuntu Mono, vendored with its licence and waited for before xterm measures', () => {
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor/fonts/ubuntu-mono-latin-wght-normal.woff2')));
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor/fonts/ubuntu-mono-LICENSE.txt')));
  assert.match(base, /font-family: 'Ubuntu Mono';[\s\S]{0,120}font-weight: 400 700;/);
  assert.match(client, /const TERM_FONT = '"Ubuntu Mono", /);
  assert.match(client, /document\.fonts\.load\(/);
});

test('the default text size is larger than the 13px it was', () => {
  const m = client.match(/const FONT_DEFAULT = (\d+);/);
  assert.ok(m && Number(m[1]) >= 16, 'at least the 16px of the Ubuntu terminal');
  assert.match(client, /fontSize: look\.size,/);
});

test('the menu offers exactly the styles terminal.js has a palette for', () => {
  const ids = TERM_STYLES.map(([id]) => id);
  const order = (client.match(/const STYLE_ORDER = \[([^\]]+)\]/) || [])[1] || '';
  assert.deepEqual(order.split(',').map((s) => s.trim().replace(/'/g, '')), ids);
  assert.equal(ids[0], 'ubuntu', 'Ubuntu is the default and the first');
  const html = termPaneHtml('s');
  for (const id of ids) assert.match(html, new RegExp(`data-term-style="${id}"`));
});

test('text size: buttons, Ctrl and plus, minus and zero, and Ctrl and the wheel', () => {
  const html = termPaneHtml('s');
  for (const how of ['down', 'up', 'reset']) assert.match(html, new RegExp(`data-term-font="${how}"`));
  assert.match(client, /attachCustomKeyEventHandler/);
  assert.match(client, /if \(e\.ctrlKey\) \{ stepFont\(/);
  assert.match(client, /const FONT_MIN = 11;/);
  assert.match(client, /const FONT_MAX = 32;/);
});

test('the look is a per-browser preference applied to every open window', () => {
  assert.match(client, /const FONT_KEY = 'ws-term-font';/);
  assert.match(client, /const STYLE_KEY = 'ws-term-style';/);
  assert.match(client, /function paintLook\(\) \{[\s\S]{0,260}windows\(\)\.forEach/);
  assert.match(client, /the Dashboard style is read from the page's tokens|The Dashboard style is read from the page's tokens/);
});

test('the window wears the palette, set as properties and never written as colours', () => {
  for (const v of ['--term-bg', '--term-fg', '--term-bar', '--term-bar-ink']) {
    assert.ok(css.includes(`var(${v}`), `${v} is read by the stylesheet`);
    assert.ok(client.includes(`'${v}'`), `${v} is set by terminal.js`);
  }
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'no hex in a component');
});

test('the header wraps and the buttons keep one square size at every width', () => {
  assert.match(css, /\.term-window-head \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /@container term \(min-width: 56rem\)/);
  assert.match(css, /container: term \/ inline-size;/);
});

test('a window never opens taller than the room under its top edge', () => {
  assert.match(client, /window\.innerHeight - top - 8/);
});

test('a click inside a window is only taken by the look menu, because the window itself carries the style', () => {
  assert.match(client, /closest\('\.term-look-menu \[data-term-style\]'\)/);
  assert.match(client, /closest\('\.term-look-menu \[data-term-font\]'\)/);
  assert.doesNotMatch(client, /closest\('\[data-term-style\]'\)/);
});

test('a terminal opened from the Screens modal closes the modal first, so the keyboard reaches it', () => {
  assert.match(client, /modal && modal\.contains\(open\) && window\.UIkit/);
  assert.match(client, /window\.UIkit\.modal\(modal\)\.hide\(\)/);
  assert.match(client, /__term\.focus\(\)/);
});
