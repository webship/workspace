/**
 * Below 960px the AI Assistant floats over the page; it does not sit above it.
 *
 * The views stylesheet moved the panel to the bottom of the screen there, but an older rule (assembled later)
 * made it position: static, so on a phone it was a 512px band between the top bar and every page, open by
 * default: at 390×844 a folder page started at 852px (round 7). Now it floats, starts closed on a narrow
 * screen when nothing was chosen, takes focus when the corner launcher opens it, and keeps what has focus
 * above itself.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const views = noComments(read('public/css/components/assistant-views.css'));
const mic = noComments(read('public/css/components/mic-on-any-field-that-wants-typing.css'));
const server = read('server.js');
const ui = read('public/ui.js');

test('below 960px the sidebar and wide views are a floating panel', () => {
  const narrow = views.slice(views.indexOf('@media (max-width: 59.99em) {'));
  assert.match(narrow, /html\[data-assistant-view="sidebar"\] \.assistant-side \{\s*position: fixed;/);
  // Nothing makes it a block in the flow again.
  assert.doesNotMatch(mic, /\.assistant-side \{[^}]*position:\s*static/);
  for (const f of fs.readdirSync(path.join(APP, 'public', 'css', 'components'))) {
    const css = noComments(read(`public/css/components/${f}`));
    assert.doesNotMatch(css, /\.assistant-side \{[^}]*position:\s*static/, `${f} puts the panel back in the flow`);
  }
});

test('open, the panel keeps focus and the end of the page above itself', () => {
  const narrow = views.slice(views.indexOf('@media (max-width: 59.99em) {'));
  assert.match(narrow, /html\[data-assistant-view="sidebar"\]:not\(\.assistant-closed\) \{ scroll-padding-bottom: calc\(min\(32rem, calc\(100vh - 6rem\)\) \+ 1\.5rem\); \}/);
  assert.match(narrow, /html\[data-assistant-view="sidebar"\]:not\(\.assistant-closed\) \.app-content \{ padding-bottom: calc\(min\(32rem, calc\(100vh - 6rem\)\) \+ 1\.5rem\); \}/);
  // The height it makes room for is the panel's own.
  assert.match(narrow, /height: min\(32rem, calc\(100vh - 6rem\)\);/);
});

test('on a narrow screen it starts closed unless the person chose', () => {
  assert.match(server, /if\(o===null\)o=\('\$\{style\.assistantOpen\}'==='no'\|\|\(window\.matchMedia&&matchMedia\('\(max-width: 59\.99em\)'\)\.matches\)\)\?'0':'1';/);
  // A stored choice still wins: the default applies only when nothing is stored.
  assert.match(server, /var o=wsPref\('ws-assistant-open',null\);/);
});

test('the corner launcher gives focus to the prompt it opens', () => {
  // (From the selector: where the part's TypeScript has a type, ui.js holds blank space.)
  const launcher = ui.slice(ui.indexOf("closest('.assistant-launcher')) {"));
  assert.match(launcher.slice(0, 400), /setAssistantOpen\(true\);\s*focusAssistantPrompt\(\);/);
  assert.match(ui, /chat\.shadowRoot\.querySelector\s*\('#text-input'\)/);
});
