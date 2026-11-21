/**
 * With the assistant open beside the page on a laptop, expanding the actions rail squeezed the content: at
 * 1024 the Dev page's build form was cut to a 281px card ("Drupa", "Bui"), at 1280 to a 537px one. Where
 * there is no room (25rem of assistant, or the wide view's 45rem, beside 15.5rem of rail and 44rem of
 * content), the rail now opens over the content, only when asked, and closes on a click outside or Escape.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const APP = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(APP, ...p), 'utf8');
const SIDEBAR = '(min-width: 60em) and (max-width: 84.4375em)';
const WIDE = '(min-width: 60em) and (max-width: 104.4375em)';

test('where there is no room, the content keeps the collapsed rail\'s width and the open rail casts a shadow over it', () => {
  const css = read('public', 'css', 'components', 'full-height-right-actions-rail-pages-that-have-actions.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [view, q] of [['sidebar', SIDEBAR], ['wide', WIDE]]) {
    const at = css.indexOf(`@media ${q}`);
    assert.ok(at >= 0, `no rule for the ${view} view`);
    const block = css.slice(at, css.indexOf('}\n}', at) + 3);
    assert.match(block, new RegExp(`html\\[data-assistant-view="${view}"\\]:not\\(\\.assistant-closed\\) \\.app-content\\.has-actions \\{ margin-right: 3\\.5rem; \\}`));
    assert.match(block, new RegExp(`html\\[data-assistant-view="${view}"\\]:not\\(\\.assistant-closed\\):not\\(\\.actions-collapsed\\) \\.actions-side \\{ box-shadow: var\\(--shadow-float\\); \\}`));
  }
});

test('the page starts with the rail collapsed there, before first paint, whatever was remembered', () => {
  const src = read('server.js');
  const at = src.indexOf("var rq=rv==='sidebar'?");
  assert.ok(at > 0, 'no check in the head script');
  const line = src.slice(at, src.indexOf('\n', src.indexOf('\n', at) + 1));
  assert.ok(line.includes(`'${SIDEBAR}'`) && line.includes(`'${WIDE}'`), 'the widths are not the rail CSS\'s');
  assert.match(line, /if\(rq&&matchMedia\(rq\)\.matches\)d\.classList\.add\('actions-collapsed'\)/);
});

test('there, the toggle opens it without remembering it, and a click outside or Escape closes it', () => {
  const ui = read('public', 'ui.js');
  const fn = ui.slice(ui.indexOf('function railTight()'), ui.indexOf('// Collapsed is the default'));
  assert.ok(fn.includes(`'${SIDEBAR}'`) && fn.includes(`'${WIDE}'`), 'ui.js decides with other widths than the CSS');
  assert.match(ui, /applyActionsCollapsed\(wsPref\('actions-collapsed', '1'\) !== '0' \|\| railTight\(\)\)/);
  assert.match(ui, /if \(!railTight\(\)\) wsPrefSet\('actions-collapsed', collapsed \? '1' : '0'\);/, 'opened there, it is not remembered');
  const close = ui.slice(ui.indexOf('// Open over the content, the rail closes'), ui.indexOf('// The rail\'s names and its tooltip'));
  assert.match(close, /e\.target\.closest\('\.actions-side, \.uk-dropdown, \.uk-modal, #rail-tip'\)\) return;/, 'a menu or a modal it opened is not outside');
  assert.match(close, /e\.key !== 'Escape'/);
  assert.match(close, /if \(document\.querySelector\('\.uk-modal\.uk-open, \.uk-dropdown\.uk-open'\)\) return;/, 'Escape first closes what is open on top');
  assert.match(close, /toggle\.focus\(\)/, 'focus goes back to the toggle');
});
