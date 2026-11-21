/**
 * Text contrast (round 7, axe 4.14): UIkit's muted grey and the Styles cards in dark.
 *
 * The AI folders' shared-only rows were UIkit's #999 (2.84:1 on white) in every light style. On /settings/styles
 * in dark each card is painted in its style's light surface, but its contents took the dark half's light inks:
 * 1.17:1 for "Change its variables", 2.63:1 for the meta line, 3.9:1 for "In use".
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const base = fs.readFileSync(path.join(APP, 'public', 'css', 'base.css'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const { themePreview } = require(path.join(APP, 'themes.js'));

test('muted text is the theme\'s subtle ink, not UIkit\'s grey', () => {
  assert.match(base, /\.uk-text-muted \{ color: var\(--text-subtle\) !important; \}/);
});

test('a style\'s preview carries the inks its card is drawn in', () => {
  const p = themePreview('default');
  assert.ok(p, 'the default style has a preview');
  for (const k of ['text', 'subtle', 'ink', 'inverse', 'link', 'surface', 'line']) assert.ok(p[k], `preview.${k}`);
  assert.notStrictEqual(p.ink, 'var(--brand-secondary)', 'an alias is resolved to its value');
});

test('a style card sets those inks on itself, so its contents are its light half in either mode', () => {
  const page = server.slice(server.indexOf('function stylesPageHtml('));
  const tokens = page.slice(page.indexOf('const tokens = ['), page.indexOf('const skin = ['));
  for (const t of ['--surface-card', '--line', '--text-default', '--text-subtle', '--ink', '--chip-ink', '--text-inverse', '--link']) {
    assert.ok(tokens.includes(`'${t}'`), `${t} is set on the card`);
  }
  // The meta line is the dashboard's words, in the style's text colour (two styles' own subtle ink is 3.7:1).
  assert.match(tokens, /\['--text-subtle', p\.text\]/);
  assert.match(page, /\.\.\.tokens,\n\s*\]\.filter\(Boolean\)\.join\(';'\);/, 'and they go into the card\'s style attribute');
});
