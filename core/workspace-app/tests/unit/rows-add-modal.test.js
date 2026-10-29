/**
 * Add a row and add a button, in the dashboard's one modal.
 *
 * Both were controls at the bottom of a very long form — the add-a-button one carried eight fields there. In the modal
 * they have to keep two properties the inline versions got for free by sitting inside the rows form: the unsaved
 * arrangement travels with the write (a drag not yet saved is part of what the layout should become), and the editor
 * behind the modal is what answers.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rowsmodal-'));
process.env.ROW_ACTIONS_FILE = path.join(tmp, 'row-actions.yml');
process.env.ROW_ACTIONS_SEEN_FILE = path.join(tmp, 'row-actions.seen.json');
process.env.ROW_ACTIONS_HISTORY_FILE = path.join(tmp, 'row-actions.history.jsonl');
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const rl = require('../../row-layout');
const APP = path.join(__dirname, '..', '..');

test('the editor opens both in the modal, and nothing is left inline', () => {
  const html = rl.rowActionsEditorHtml();
  assert.match(html, /hx-get="\/fragments\/row\/add-row"[\s\S]{0,120}hx-target="#editor-modal-body"/);
  assert.match(html, /hx-get="\/fragments\/row\/add-button"[\s\S]{0,120}hx-target="#editor-modal-body"/);
  assert.doesNotMatch(html, /for_button":"__new__/, 'the add-a-button form is no longer in the page');
});

test('both forms carry the rows form, so an unsaved arrangement is not lost', () => {
  const row = rl.addRowFormHtml();
  assert.match(row, /hx-post="\/actions\/row-rows"/);
  assert.match(row, /hx-include="#row-arrange-form"/);
  assert.match(row, /hx-vals='\{"op":"add","pane":"0","mtime":"[0-9.]+"\}'/, 'and the mtime it was drawn with');
  assert.match(row, /hx-target="#row-actions-editor" hx-swap="outerHTML"/);

  const button = rl.addButtonFormHtml();
  assert.match(button, /hx-post="\/actions\/row-custom-add"/);
  assert.match(button, /hx-include="#row-arrange-form, closest \.row-add-action"/);
  assert.match(button, /name="add_button_new"/, 'it still names the button');
  assert.match(button, /name="add_label_new"/);
  assert.match(button, /hx-target="#row-actions-editor" hx-swap="outerHTML"/);
});

test('a full set of rows says so instead of offering a button that would be refused', () => {
  const rows = Array.from({ length: rl.MAX_ROWS }, () => []);
  rl.saveRowLayout(rl.normalizeLayout({ rows }), '');
  const html = rl.addRowFormHtml();
  assert.match(html, new RegExp(`All ${rl.MAX_ROWS} rows are in use`));
  assert.doesNotMatch(html, /hx-post="\/actions\/row-rows"/);
  rl.resetRowLayout('');
});

test('the fragments are served, and the modal closes on the event that names what was swapped', () => {
  const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(src, /pathname === '\/fragments\/row\/add-row' \|\| pathname === '\/fragments\/row\/add-button'/);
  assert.match(src, /rowLayout\.addRowFormHtml\(\) : rowLayout\.addButtonFormHtml\(\)/);

  const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
  const at = ui.indexOf("e.target.id !== 'row-actions-editor'");
  assert.ok(at > 0, 'nothing closes the modal when the editor comes back');
  const handler = ui.slice(ui.lastIndexOf('document.body.addEventListener', at), ui.indexOf('});', at));
  assert.match(handler, /htmx:after:settle/, "after:swap names the element that MADE the request in htmx 4, not the swapped one");
  assert.match(handler, /UIkit\.modal\('#editor-modal'\)\.hide\(\)/);
  assert.doesNotMatch(rl.addRowFormHtml(), /event\.detail\.successful/, 'that flag does not exist in htmx 4');
});
