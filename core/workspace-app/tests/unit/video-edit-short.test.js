/**
 * The video editor is short.
 *
 * Even with the dialog capped to the screen the tabs held too much at once: Sections stacked three groups (1404px)
 * and Logo and music stacked Opening over Closing (1040px). A person does one of those at a time.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const edit = fs.readFileSync(path.join(__dirname, '..', '..', 'video-edit.js'), 'utf8');

test('Sections is an accordion with one group open, and the group that applies is the open one', () => {
  assert.match(edit, /<ul class="video-edit-accordion" uk-accordion="multiple: false">/);
  assert.match(edit, /group\('Remove sections', has \? `\$\{has\} in the script` : 'no timed script', rows, has > 0\)/);
  assert.match(edit, /group\('Borrow a section from another video', '', borrowGroupHtml\(state\.file\), has === 0\)/);
  assert.match(edit, /group\('Add a section', 'a logo scene, spoken', addBody, false\)/);
});

test('the prompt is folded away until wanted, and can name a project or a link', () => {
  assert.match(edit, /<details class="video-edit-ask uk-margin-top">/);
  assert.match(edit, /<summary class="uk-form-label">Prompt the AI to make more changes or tweaks/);
  assert.match(edit, /name="ask_project"/);
  assert.match(edit, /name="ask_link" type="url"/);
  assert.match(edit, /<optgroup label="\$\{esc\(ws\)\}">/, 'projects are grouped by workspace');
});

test('Opening and Closing sit side by side', () => {
  assert.match(edit, /uk-child-width-1-2@m" uk-grid><div>\$\{side\('intro', 'Opening'\)\}<\/div><div>\$\{side\('outro', 'Closing'\)\}/);
});

test('every control has a name, and the current tab and the result are announced', () => {
  assert.match(edit, /const named = \(control, label\) =>/);
  assert.match(edit, /\$\{named\(control, label\)\}<\/div>`;/, 'field() names the control it labels');
  assert.match(edit, /aria-label="Video to borrow from"/);
  assert.match(edit, /select\(`borrow_after_\$\{n\}`, after, 'end', 'Where the borrowed part goes'\)/);
  assert.match(edit, /name="add_text" aria-label="What the new section says"/);
  assert.match(edit, /\$\{id === mode \? ' aria-current="true"' : ''\}/);
  assert.match(edit, /<div id="voice-result" class="uk-margin-top" role="status" aria-live="polite"><\/div>/);
});
