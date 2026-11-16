/**
 * The Screens modal on a phone, and the notice that opens it.
 *
 * Measured in round 7 on 1.0.17: the modal's body scrolled sideways at 320, 360 and 768px (a session card's
 * text column would not shrink below its longest word), and the notice whose "Open in Screens" opened the
 * modal stayed on top of it — over the heading and the Close button — while the pointer rested on it. A
 * plugin's notice without the .notice-text wrapper was also laid out as five flex columns at 390px.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'grid-and-list.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('a session card\'s text column may shrink, and its long words wrap', () => {
  assert.match(css, /\.screen-tile \.uk-flex-1 \{[^}]*min-width:\s*0/, 'the column keeps its min-content width');
  assert.match(css, /\.screen-tile \.uk-flex-1 strong,\s*\.screen-tile code \{[^}]*overflow-wrap:\s*anywhere/, 'a session name and a path are one long word');
  assert.match(css, /\.screen-tile \.uk-label,\s*\.screen-tile code \{[^}]*white-space:\s*normal/, 'UIkit labels and inline code do not wrap by default');
  // A label breaks between words only: "DETACHED" split as "DETACHE / D" when the whole column could break anywhere.
  assert.doesNotMatch(css, /\.screen-tile \.uk-flex-1 \{[^}]*overflow-wrap/, 'not the whole column');
});

test('on a phone the terminal picture sits above the words, not beside them', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 39.9375em)'));
  assert.match(phone, /\.screen-tile > \.uk-flex \{[^}]*flex-wrap:\s*wrap/);
  assert.match(phone, /\.screen-tile > \.uk-flex > \.uk-flex-1 \{[^}]*flex-basis:\s*100%/);
});

test('following a link in a notice closes the notice, as its close button does', () => {
  const block = ui.slice(ui.indexOf("const close = e.target.closest('.flash-toast-close');"));
  assert.match(block, /e\.target\.closest\('\.flash-toast a\[href\]'\)/, 'a link inside a notice is a way out of it');
  assert.match(block, /if \(link && \(toast\.classList\.contains\('error'\) \|\| toast\.classList\.contains\('flash-stay'\)\)\) return;/,
    'an error or a notice that stays until closed is kept');
  assert.match(block, /if \(link\) setTimeout\(\(\) => toast\.remove\(\), 0\); else toast\.remove\(\);/,
    'the link does its own work first');
  // And it is the same document-level click the Screens modal is opened from, registered after it, so
  // the modal is already on its way when the notice goes.
  assert.ok(ui.indexOf('function screensModalUrl(href)') < ui.indexOf("const close = e.target.closest('.flash-toast-close');"));
});

test('a notice is one sentence: a message that is not one wrapper is put in .notice-text', () => {
  const block = ui.slice(ui.indexOf('function flashResults(root)'), ui.indexOf('function reloadForChanges()'));
  assert.match(block, /text\.className = 'notice-text';/);
  // Before the close button is added, so the button stays the toast's own child.
  assert.ok(block.indexOf("text.className = 'notice-text';") < block.indexOf("close.className = 'flash-toast-close';"));
  // A message that is already one element (.notice-text, .no-screen-body) is left as it is.
  assert.match(block, /if \(!\(loose\.length === 1 && loose\[0\]\.nodeType === 1\)\)/);
});
