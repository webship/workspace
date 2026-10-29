/**
 * The editor modal fits the screen.
 *
 * At 1080px high New screen was 1205px tall (1565 with Claude Code) and its Start button sat 130 to 490px below
 * the fold, with its title scrolled away above it; Sections of the video editor was 1404px. The dialog is now capped
 * to the viewport and is a column: title and tabs pinned, the form scrolling, the action row pinned. The editors
 * take the height that is left. A form opts in with `.modal-head` and `.modal-actions`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const css = read('public/css/components/modal-fit.css');
const { assembleCss, listComponents } = require('../../themes');

test('the stylesheet is a component and comes after the rules it overrides', () => {
  const list = listComponents();
  assert.ok(list.includes('modal-fit'));
  assert.ok(list.indexOf('modal-fit') > list.indexOf('settings-editor-core-config-yml'),
    'the editor height rule it replaces is in the settings component, and a later one wins');
  assert.match(assembleCss(''), /\/\* component: modal-fit \*\//);
});

test('the dialog is capped to the screen, a column, with its own scroll that does not chain', () => {
  assert.match(css, /#editor-modal \.uk-modal-dialog \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*max-height: calc\(100dvh - 7rem\);/s);
  assert.match(css, /#editor-modal \.uk-modal-body \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/s);
});

test('the title is pinned above and the actions below, with no strip for the form to scroll through', () => {
  assert.match(css, /#editor-modal \.modal-head \{[^}]*position: sticky;[^}]*top: 0;/s);
  assert.match(css, /\.modal-actions,\s*#editor-modal form > :last-child:has\(> button\[type="submit"\]\) \{[^}]*position: sticky;[^}]*bottom: 0;/s);
  assert.match(css, /\.uk-modal-body:has\(\.modal-head\) \{ padding-top: 0; \}/);
  assert.match(css, /\.uk-modal-body:has\(\.modal-actions\) \{ padding-bottom: 0; \}/);
});

test('editors take the height that is left of the screen, never a fixed share of it', () => {
  assert.match(css, /\.ace-host:not\(\.ace-host-single\) \{\s*height: clamp\(12rem, calc\(100dvh - 19rem\), 46rem\) !important;/);
  assert.match(css, /\.new-screen-card \.ace-host:not\(\.ace-host-single\) \{\s*height: clamp\(11rem, calc\(100dvh - 44rem\), 26rem\)/);
});

test('New screen asks for the prompt before the Claude options', () => {
  assert.match(css, /fieldset\[data-claude-only\] \{ order: 3; \}/);
  assert.match(css, /fieldset:not\(\[data-claude-only\]\):last-of-type \{ order: 2; \}/);
});

test('the forms carry the two classes', () => {
  assert.match(read('screens.js'), /<div class="modal-head">\s*<h3 class="uk-margin-small-bottom">New screen<\/h3>/);
  assert.match(read('screens.js'), /<p class="modal-actions"><button class="uk-button uk-button-primary" type="submit">Start it<\/button><\/p>/);
  assert.match(read('video-edit.js'), /const head = `<div class="modal-head"><h3[^>]*>Edit a video<\/h3>\$\{tabsHtml\(chosen, tab\)\}<\/div>`/);
  assert.match(read('video-edit.js'), /<div class="modal-actions">\s*<button type="submit" class="uk-button uk-button-primary">/);
  assert.match(read('audio-voice.js'), /<div class="modal-actions">/);
  assert.match(read('audio-voice.js'), /<div class="modal-head"><h3[^>]*>\$\{video \? 'Voice over a video' : 'Generate a voice'\}<\/h3><\/div>/);
});

test('motion honours the system setting', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*uk-accordion-content[^}]*transition-duration: 0\.01ms !important;/s);
});

test('the dialog is named, and the page behind it is out of reach while it is open', () => {
  const server = read('server.js');
  const ui = read('public/ui.js');
  assert.ok(!/id="editor-modal"[^>]*role="dialog"/.test(server), 'UIkit puts role="dialog" on the inner dialog, so a second one is not added outside it');
  assert.match(ui, /function containEditorModal\(open\)/);
  assert.match(ui, /el\.inert = true;/);
  assert.match(ui, /el\.inert = el\.dataset\.wasInert === '1';/, 'what was inert before is left as it was');
  assert.match(ui, /el\.id === 'confirm-modal'/, 'the confirm dialog that stacks above it stays reachable');
  assert.match(ui, /dialog\.setAttribute\('aria-label', h\.textContent/, 'the inner .uk-modal-dialog is the one that is named');
  assert.match(ui, /containEditorModal\(false\);/);
});

test('no inner scroll box inside the scrolling body, and the focus ring and checkbox edge are visible', () => {
  assert.match(css, /#editor-modal \.video-edit-sections \{ max-height: none; overflow: visible; \}/);
  assert.match(css, /\.modal-actions \.uk-button:focus-visible[\s\S]*outline: 2px solid var\(--brand-primary\)/);
  assert.match(css, /#editor-modal \.uk-checkbox,\s*#editor-modal \.uk-radio \{ border-color: var\(--text-subtle\); \}/);
  assert.match(css, /#editor-modal \.editor-card\.uk-margin-top \{ margin-top: 0; \}/, 'the pinned header sits flush at the top of the body');
});

test('controls that sit beside their label are named, and a checkbox is a 24px target', () => {
  assert.match(read('audio-voice.js'), /aria-label="\$\{esc\(NAMES\[name\] \|\| name\)\}"/);
  assert.match(read('audio-voice.js'), /duration: 'Length of the sound', influence: 'How closely to follow the description', length: 'Length of the music'/);
  assert.match(read('screens.js'), /name="resume" disabled aria-label="Claude conversation to resume"/);
  assert.match(css, /#editor-modal \.uk-checkbox,\s*#editor-modal \.uk-radio \{ width: 1\.5rem; height: 1\.5rem; \}/);
});
