/**
 * The editor modal is named by what it shows (#811): aria-labelledby on the heading of the content swapped into it,
 * with "Editor" as the name before any content arrives or when the content has no heading. UIkit puts role="dialog" on
 * the inner .uk-modal-dialog, and it has been seen on #editor-modal itself, so both are named.
 *
 * nameEditorModal is taken from its ui.js part and run against a small stand-in of the modal.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.join(import.meta.dirname, '..', '..');
const part = fs.readFileSync(path.join(APP, 'src', 'browser', 'ui', '01-core.js'), 'utf8');
const start = part.indexOf('function nameEditorModal() {');
const source = part.slice(start, part.indexOf('\n}\n', start) + 2);

class FakeEl {
  id: string; textContent: string; attrs: Record<string, string>;
  constructor(attrs: Record<string, string> = {}, text = '') { this.attrs = { ...attrs }; this.id = attrs.id || ''; this.textContent = text; }
  setAttribute(k: string, v: string): void { this.attrs[k] = String(v); }
  getAttribute(k: string): string | null { return k in this.attrs ? this.attrs[k]! : null; }
  removeAttribute(k: string): void { delete this.attrs[k]; }
}
/** A modal holding a dialog and, maybe, a heading in its body; and the nameEditorModal of ui.js run against it. */
function modalWith(heading: FakeEl | null, attrs: Record<string, string> = { 'aria-label': 'Editor' }) {
  const dialog = new FakeEl(attrs);
  const modal = Object.assign(new FakeEl(attrs), {
    querySelector: (sel: string) => (sel === '.uk-modal-dialog' ? dialog : /#editor-modal-body/.test(sel) ? heading : null),
  });
  const document = { getElementById: (id: string) => (id === 'editor-modal' ? modal : null) };
  const run = new Function('document', `${source}\nreturn nameEditorModal;`)(document) as () => void;
  return { modal, dialog, run };
}

test('the modal and its dialog are named by the heading of what was swapped in, given an id when it has none (#811)', () => {
  const h = new FakeEl({}, ' Settings ');
  const { modal, dialog, run } = modalWith(h);
  run();
  assert.strictEqual(h.id, 'editor-modal-title');
  for (const el of [modal, dialog]) {
    assert.strictEqual(el.getAttribute('aria-labelledby'), 'editor-modal-title');
    assert.strictEqual(el.getAttribute('aria-label'), 'Editor', 'the fallback stays, under the heading');
  }
  // A heading that has an id keeps it.
  const own = new FakeEl({ id: 'plugin-title' }, 'WordPress');
  const two = modalWith(own);
  two.run();
  assert.strictEqual(two.dialog.getAttribute('aria-labelledby'), 'plugin-title');
});

test('with no heading, or an empty one, the name is "Editor", and a heading from before does not stay (#811)', () => {
  const { modal, dialog, run } = modalWith(null, { 'aria-label': 'Editor', 'aria-labelledby': 'stale-title' });
  run();
  for (const el of [modal, dialog]) {
    assert.strictEqual(el.getAttribute('aria-labelledby'), null);
    assert.strictEqual(el.getAttribute('aria-label'), 'Editor');
  }
  const empty = modalWith(new FakeEl({}, '   '), {});
  empty.run();
  assert.strictEqual(empty.dialog.getAttribute('aria-labelledby'), null);
  assert.strictEqual(empty.dialog.getAttribute('aria-label'), 'Editor', 'set when the markup had none');
});

test('the page names it "Editor" before any content, and names it again on every swap and every opening (#811)', () => {
  const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  assert.match(server, /<div id="editor-modal" class="uk-modal-container" aria-label="Editor" uk-modal=/);
  assert.match(server, /<div class="uk-modal-dialog" aria-label="Editor">/);
  assert.match(part, /if \(swappedEl\(e\)\?\.id === 'editor-modal-body'\) nameEditorModal\(\);/);
  assert.match(part.slice(part.indexOf("document.addEventListener('shown'")), /nameEditorModal\(\);/);
});
