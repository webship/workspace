const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tabModalHtml } = require('../../tab-modal');

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const groups = [
  { id: 'a', label: 'First', tabs: [
    { id: 'one', label: 'One', url: '/x/one', hint: 'The first' },
    { id: 'two', label: 'Two <b>', url: '/x/two', badge: '3' } ] },
  { id: 'b', label: 'Second', tabs: [{ id: 'three', label: 'Three', url: '/x/three' }] },
];

test('tabs are buttons in a vertical tablist, one selected, each loading its own fragment', () => {
  const html = tabModalHtml({ id: 'demo', title: 'Demo', groups, active: 'two' });
  assert.match(html, /role="tablist" aria-orientation="vertical"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, /id="tm-demo-two"[^>]*aria-selected="true"/);
  assert.match(html, /hx-get="\/x\/three" hx-target="#tm-demo-pane"/);
  assert.match(html, /id="tm-demo-pane" role="tabpanel"/);
  assert.match(html, /hx-get="\/x\/two" hx-trigger="load"/, 'the pane loads the open tab');
});

test('an unknown tab opens the first, and labels are escaped', () => {
  const html = tabModalHtml({ id: 'demo', title: 'Demo', groups, active: 'nope' });
  assert.match(html, /id="tm-demo-one"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /Two <b>/);
  assert.match(html, /Two &lt;b&gt;/);
});

test('the address is kept only when the modal asks for it, and a back link is a button', () => {
  assert.doesNotMatch(tabModalHtml({ id: 'demo', title: 'Demo', groups }), /data-hash/);
  assert.match(tabModalHtml({ id: 'demo', title: 'Demo', groups, hash: true }), /data-tabmodal="demo" data-hash/);
  const back = tabModalHtml({ id: 'demo', title: 'Demo', groups, back: { label: 'Workitems', url: '/list' } });
  assert.match(back, /<button type="button" class="tabmodal-back" hx-get="\/list"/);
});

test('the settings modal and the workitem modal are built from it', () => {
  const server = read('server.js');
  assert.match(server, /tabModal\.tabModalHtml\(\{ id: 'settings'/);
  assert.match(server, /tabModal\.tabModalHtml\(\{\s*id: 'workitem'/);
  assert.match(server, /const isFragment = \(req\)/);
  assert.match(server, /if \(options\.fragment\) return/);
});

test('the rail Settings tile opens the modal and keeps its address for a new tab', () => {
  const server = read('server.js');
  assert.match(server, /'\/fragments\/settings\/modal'\)/);
  assert.match(server, /data-tabmodal-open=/);
  const ui = read('public', 'ui.js');
  assert.match(ui, /\[data-tabmodal-open\]/);
  assert.match(ui, /\^#\(settings\)\\\/\(\[\^\/\]\+\)\$/);
});

test('behaviour: selection, arrow keys, a filter, links stay in the pane', () => {
  const ui = read('public', 'ui.js');
  assert.match(ui, /'ArrowDown', 'ArrowUp', 'Home', 'End'/);
  assert.match(ui, /tabmodal-filter/);
  assert.match(ui, /\.tabmodal-pane a\[href\^="\/settings"\]/);
  assert.match(ui, /aria-selected/);
});

test('the styles use tokens only', () => {
  const css = read('public', 'css', 'components', 'tab-modal.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});
