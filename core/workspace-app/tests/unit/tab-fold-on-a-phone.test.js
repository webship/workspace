/**
 * On a phone a modal's tab list folds behind a button that says the tab you are on (webship/workspace#669).
 *
 * At 390×844 the Settings list took the top of the screen in a 250px box of six tabs, and the tab's content started
 * at 430px. Below 640px the filter and the list now fold behind a button (aria-expanded, aria-controls) that says the
 * chosen tab; choosing a tab folds the list and gives the button focus; Escape in the open list folds it before it
 * closes the modal. Wider screens keep the list as it was. Checked in a browser at 390 and 1440 too.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const { tabModalHtml } = require('../../tab-modal.mts');
const css = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'tab-modal.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');

const html = tabModalHtml({ id: 'settings', title: 'Settings', filter: true, active: 'general', groups: [
  { id: 'base', label: 'Workspace base', tabs: [
    { id: 'overview', label: 'Overview', url: '/settings?fragment=1', icon: 'tabler:list-search' },
    { id: 'general', label: 'General', url: '/settings/settings.yml?fragment=1', icon: 'tabler:settings' }] }] });

test('the button says the chosen tab and controls the folded part: the filter and the tab list', () => {
  const button = html.slice(html.indexOf('<button type="button" class="tabmodal-toggle"'), html.indexOf('</button>', html.indexOf('tabmodal-toggle')));
  assert.match(button, /aria-expanded="false" aria-controls="tm-settings-list"/);
  assert.match(button, /<span class="tabmodal-toggle-label">General<\/span><span class="uk-hidden-visually">: choose another tab<\/span>/);
  const list = html.slice(html.indexOf('<div class="tabmodal-list" id="tm-settings-list">'));
  assert.ok(list.indexOf('class="tabmodal-filter') > 0 && list.indexOf('role="tablist"') > list.indexOf('class="tabmodal-filter'), 'the filter, then the list, inside what folds');
  assert.ok(html.indexOf('tabmodal-toggle') < html.indexOf('tabmodal-list'), 'the button comes before what it folds');
});

test('the button shows and the list folds only below 640px; the list keeps its column everywhere', () => {
  assert.match(css, /\.tabmodal-toggle \{ display: none;/);
  const phone = css.slice(css.indexOf('@media (max-width: 39.9375em) {'));
  const block = phone.slice(0, phone.indexOf('\n}\n') + 2);
  assert.match(block, /\.tabmodal-nav \.tabmodal-toggle \{ display: flex; \}/);
  assert.match(block, /\.tabmodal:not\(\.is-open\) \.tabmodal-list \{ display: none; \}/);
  assert.match(block, /\.tabmodal:not\(\.is-open\) \{ grid-template-rows: auto minmax\(0, 1fr\); \}/);
  assert.match(block, /\.tabmodal\.is-open \{ grid-template-rows: fit-content\(60%\) minmax\(0, 1fr\); \}/);
  assert.match(css, /\.tabmodal-list \{ display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; \}/, 'the nav\'s column goes on through the wrapper, so the list still scrolls inside it');
});

test('the script: the button opens and folds, a choice folds it and gives the button focus, Escape folds before it closes', () => {
  assert.match(ui, /const toggle = \(?e\.target\s*\)?\.closest && \(?e\.target\s*\)?\.closest\('\.tabmodal-toggle'\);/);
  assert.match(ui, /const t = folds\(tm\);\s*if \(t\) fold\(tm, false, t\);/, 'a chosen tab folds the list and focuses the button');
  assert.match(ui, /if \(label\) label\.textContent = tab\.dataset\.label \|\| '';/, 'the button says the tab chosen');
  // Escape, in the capture phase, ahead of the modal's own; a filter with text in it is emptied first.
  // (From the selector: where the part's TypeScript has a type, ui.js holds blank space.)
  const esc = ui.slice(ui.indexOf("('.tabmodal.is-open');") - 200);
  assert.match(esc, /if \(box && box\.value\) return;\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*fold\(tm\s*, false, t\);\s*\}, true\);/);
  // Only where the button is shown: offsetParent is null where CSS hides it, so wider screens are unchanged.
  assert.match(ui, /const folds = \(tm\s*\) => \{ const t = tm && tm\.querySelector\s*\('\.tabmodal-toggle'\); return t && t\.offsetParent \? t : null; \};/);
});
