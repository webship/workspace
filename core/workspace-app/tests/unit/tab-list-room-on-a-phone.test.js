/**
 * On a phone the tab modal's list of tabs has room: up to 45% of the modal, not a fixed 11rem.
 *
 * Round 7 at 390×844: the 11rem column went mostly to the title and the filter, and the 68 tabs of Settings
 * scrolled inside an 84px box — two in view. With the row sized to its content up to 45%, six are in view
 * and the pane keeps 293px.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'tab-modal.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const phone = css.slice(css.indexOf('@media (max-width: 59.9375em) {'));

test('the list row is sized to its content, up to 45% of the modal', () => {
  assert.match(phone, /\.tabmodal \{ grid-template-columns: 1fr; grid-template-rows: fit-content\(45%\) minmax\(0, 1fr\); \}/);
  // A max-height in percent does not resolve in an auto row (the pane collapsed to 20px when tried).
  assert.doesNotMatch(phone.slice(0, phone.indexOf('}\n}') + 3), /\.tabmodal-nav \{[^}]*max-height/, 'no fixed cap left on the column');
});

test('the title and its subtitle share a line on a phone', () => {
  assert.match(phone, /\.tabmodal-title \{ display: flex; flex-wrap: wrap;/);
});
