/**
 * Three things found while the board and the reading window were driven in a browser:
 * the board's pen drew beside the pointer when the board was not 5 by 3, its Clear left some shapes,
 * and the handlers of a swap searched inside a node that is not an element.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// A script built from src/browser (npm run build:browser) is read at its source: the built file is esbuild's.
const read = (f) => {
  const ts = path.join(__dirname, '../../src/browser', f.replace(/\.js$/, '.ts'));
  return fs.readFileSync(fs.existsSync(ts) ? ts : path.join(__dirname, '../../public', f), 'utf8');
};

test('the pen reads the pointer in the drawing\'s own units, by the browser\'s matrix: the box is only the fallback', () => {
  const ui = read('assistant-avatar-ui.js');
  assert.match(ui, /const m = s\.getScreenCTM && s\.getScreenCTM\(\);\s+if \(m\) \{ const p = new DOMPoint\(e\.clientX, e\.clientY\)\.matrixTransform\(m\.inverse\(\)\); return \[p\.x, p\.y\]; \}/);
  // What that computes, for a board that fills a wide window: a 100 by 60 drawing shown 1205 by 723 in a
  // box 1444 wide is centred, 119.5 pixels in from the left. The box would put the pointer 8 units off.
  const scale = 723 / 60; const offset = (1444 - 100 * scale) / 2;
  const byMatrix = (clientX) => (clientX - offset) / scale;
  const byBox = (clientX) => (clientX / 1444) * 100;
  assert.ok(Math.abs(byMatrix(offset + 10 * scale) - 10) < 1e-9);
  assert.ok(Math.abs(byBox(offset + 10 * scale) - 10) > 6, 'which is how far beside the pointer the pen drew');
});

test('Clear takes everything off the drawing but its own definitions, whatever shape it is', () => {
  const ui = read('assistant-avatar-ui.js');
  assert.match(ui, /\[\.\.\.b\.svg\.children\]\.filter\(\(e\) => e\.tagName\.toLowerCase\(\) !== 'defs'\)\.forEach\(\(e\) => e\.remove\(\)\);/);
  assert.ok(!ui.includes("querySelectorAll('rect, circle, line, text, path:not(marker path)')"), 'not a list of shapes that misses the ellipse, the polygon and the picture');
  assert.match(ui, /shape\(s, 'ellipse'/, 'the board draws an ellipse, so Clear must take it');
  assert.match(ui, /'polygon'|"polygon"|polygon/, 'and a polygon');
});

test('a swap that names a node which is not an element searches the page, and throws nothing', () => {
  for (const f of ['ui.js', 'mic.js', 'suggest.js']) {
    const src = read(f);
    assert.ok(!src.includes('(root || document).querySelectorAll('), `${f} never searches inside whatever it is handed`);
    assert.ok(src.includes("(root && typeof root.querySelectorAll === 'function' ? root : document).querySelectorAll("), f);
  }
  // The rule, run: a text node and a fragment have no querySelectorAll of their own to call.
  const pick = (root, document) => (root && typeof root.querySelectorAll === 'function' ? root : document);
  const doc = { querySelectorAll: () => ['page'] };
  const el = { querySelectorAll: () => ['inside'] };
  assert.strictEqual(pick({ nodeType: 3, isConnected: true }, doc), doc);
  assert.strictEqual(pick(undefined, doc), doc);
  assert.strictEqual(pick(el, doc), el);
});
