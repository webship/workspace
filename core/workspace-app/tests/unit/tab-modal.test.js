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

test('the settings modal is built from it, and plugins get it through api.lib', () => {
  const server = read('server.js');
  assert.match(server, /tabModal\.tabModalHtml\(\{ id: 'settings'/);
  assert.match(read('plugin-loader.js'), /tabModalHtml,/, 'a plugin (the Jira workitem modal) builds on the same');
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

// The heading of a tab changes the moment it is chosen; its content comes from the server. A slow tab (a
// plugin page that looks for a command takes two seconds) left the tab before it under the new heading
// until its own arrived, and a request that failed left it there for good.
test('a tab that is loading marks its pane busy and says so, and shows nothing of the tab before it', () => {
  const html = tabModalHtml({ id: 'demo', title: 'Demo', groups });
  assert.match(html, /id="tm-demo-pane" role="tabpanel"[^>]*aria-busy="true"/, 'the first load is busy too');
  const ui = read('public', 'ui.js');
  const block = ui.slice(ui.indexOf('(function tabModals()'), ui.indexOf('const openFromHash'));
  assert.match(block, /pane\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(block, /note\.textContent = `Loading \$\{label \|\| 'this tab'\}…`/);
  assert.match(block, /if \(tab\) \{ const tm = tab\.closest\('\.tabmodal'\); select\(tm, tab\); busy\(tm, tab\.dataset\.label\); return; \}/,
    'choosing a tab marks its pane busy');
  assert.match(block, /busy\(tm, tab2 \? tab2\.dataset\.label : a\.textContent\.trim\(\)\)/, 'a link inside a pane does too');
  assert.match(block, /'htmx:after:swap'[\s\S]{0,160}removeAttribute\('aria-busy'\)/, 'the content that arrives ends it');
});

test('a tab that does not load says so in its pane; a request given up for another tab says nothing', () => {
  const ui = read('public', 'ui.js');
  const block = ui.slice(ui.indexOf('(function tabModals()'), ui.indexOf('const openFromHash'));
  const onError = block.slice(block.indexOf("'htmx:error'"), block.indexOf("'htmx:finally:request'"));
  assert.match(onError, /getAttribute\('aria-selected'\) !== 'true'\) return/, 'only the selected tab speaks');
  assert.match(onError, /setAttribute\('role', 'alert'\)/);
  assert.match(onError, /could not be loaded: the dashboard did not answer/);
  assert.match(onError, /textContent = /, 'the message is text, never markup');
  const onFinally = block.slice(block.indexOf("'htmx:finally:request'"));
  assert.match(onFinally, /ctx\.status === 'swapped'/, 'an answer with nothing to swap in does not leave the pane busy');
});

test('the words show after a moment and the old content is hidden then, so a quick tab does not flash', () => {
  const css = read('public', 'css', 'components', 'tab-modal.css');
  const show = css.match(/\.tabmodal-pane\[aria-busy="true"\] > \.tabmodal-wait \{[^}]*animation:\s*tabmodal-wait-show 0s linear ([\d.]+)s both/);
  assert.ok(show, 'the line shows after a delay');
  assert.ok(Number(show[1]) >= 0.1 && Number(show[1]) <= 0.4, 'long enough not to flash, short enough to be seen');
  assert.match(css, /\.tabmodal-pane\[aria-busy="true"\] > :not\(\.tabmodal-wait, \.tabmodal-loading\) \{ animation: tabmodal-wait-hide 0s linear [\d.]+s forwards; \}/);
  assert.match(css, /@keyframes tabmodal-wait-hide \{ to \{ visibility: hidden; display: none; \} \}/);
  assert.match(css, /\.tabmodal-wait \{ display: none; \}/, 'never shown when nothing loads');
});

// A pane strips the frame of a page's own card (it sits in the modal's frame already). A style's card is
// not such a frame: it is the style, painted in its own colours, and stripped of its padding and edge it
// was, in dark, a white box with its words against its edges.
test('inside a pane a page card loses its frame, but a style card keeps its padding and its edge', () => {
  const css = read('public', 'css', 'components', 'tab-modal.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.tabmodal-pane \.uk-card-default:not\(\.style-card\) \{ box-shadow: none; border: 0; padding: 0; background: transparent; \}/);
  assert.match(css, /\.tabmodal-pane \.uk-card-body:not\(\.style-card\) \{ padding: 0; \}/);
  assert.doesNotMatch(css, /\.tabmodal-pane \.uk-card-default \{/, 'no rule left that strips every card');
});

// From a design review: the "could not be loaded" message was plain body text in the pane (.msg.error is
// drawn only in the chat and the output area), with no way to ask again; and the loading line, in the
// pane's flow, pushed the old content 43px down for the moment before it hid.
test('a tab that does not load offers Try again, drawn as a message; the loading line is laid over the pane', () => {
  const ui = read('public', 'ui.js');
  const onError = ui.slice(ui.indexOf("document.addEventListener('htmx:error'"), ui.indexOf("'htmx:finally:request'"));
  assert.match(onError, /again\.textContent = 'Try again';/);
  assert.match(onError, /again\.addEventListener\('click', \(\) => \{ if \(asked\) asked\.click\(\); \}\);/, 'the same tab, asked again');
  assert.match(onError, /again\.focus\(\);/, 'focus goes to the way out');
  const css = read('public', 'css', 'components', 'tab-modal.css');
  assert.match(css, /\.tabmodal-pane \.msg\.error \{[^}]*background: var\(--danger-soft\);[^}]*border: 1px solid var\(--danger\);/);
  assert.match(css, /\.tabmodal-pane \{ position: relative; \}/);
  assert.match(css, /\.tabmodal-pane\[aria-busy="true"\] > \.tabmodal-wait \{[^}]*position: absolute;[^}]*inset: 1\.25rem 1\.5rem auto;/);
  assert.match(ui, /note\.className = 'tabmodal-wait';[\s\S]{0,260}pane\.append\(note\);/, 'after the content, so no "* + …" margin moves it');
  assert.doesNotMatch(ui, /pane\.prepend\(note\)/);
});

// On a phone the settings modal was a 702px dialog on an 844px screen, its two scrolling halves sharing it:
// 223px of tabs above 293px for the tab's content.
test('on a phone a modal with tabs takes the whole screen, and its tabs at most 40% of it', () => {
  const css = read('public', 'css', 'components', 'tab-modal.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media (max-width: 39.9375em)');
  assert.ok(at > 0, 'no phone rule');
  const phone = css.slice(at, css.indexOf('\n}\n', at) + 3);
  assert.match(phone, /#editor-modal:has\(\.tabmodal\) \{ padding: 0; \}/);
  for (const d of ['width: 100%', 'height: 100dvh', 'max-height: 100dvh', 'margin: 0', 'border-radius: 0']) assert.ok(phone.includes(d), `the dialog: ${d}`);
  assert.match(phone, /\.tabmodal \{ height: 100dvh; grid-template-rows: fit-content\(40%\) minmax\(0, 1fr\); \}/);
});
