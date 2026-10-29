const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const css = fs.readdirSync(path.join(APP, 'public', 'css', 'components'))
  .map((f) => fs.readFileSync(path.join(APP, 'public', 'css', 'components', f), 'utf8')).join('\n');

// Measured by walking Tab through /dev: the page's own content — the build form, the project
// list — was tab stop EIGHTEEN, after the toolbar, the whole assistant panel and eleven rail
// controls. With the skip link it is stop 2. That is the single biggest keyboard fix here, and
// it is invisible on screen, so nothing but a test notices it being removed.
test('a skip link is the first focusable thing, and points at the content', () => {
  assert.ok(src.includes('class="skip-link" href="#main-content"'), 'no skip link');
  assert.ok(src.includes('id="main-content"'), 'the skip link target is gone');
  // It must never be display:none or visibility:hidden — both remove it from the tab order,
  // which is the usual way a skip link ends up not working at all.
  const rule = css.slice(css.indexOf('.skip-link'), css.indexOf('.skip-link') + 700);
  assert.ok(!/display:\s*none/.test(rule), 'display:none takes the skip link out of the tab order');
  assert.ok(!/visibility:\s*hidden/.test(rule), 'visibility:hidden takes it out of the tab order');
  assert.ok(/\.skip-link:focus/.test(css), 'the skip link never becomes visible');
});

test('the build form controls have accessible names', () => {
  // A screen reader announced "edit text" and "combo box" with no indication of what either
  // was for; they are the two controls the primary task runs through.
  assert.match(src, /aria-label="Project name"/, 'the project name input has no accessible name');
  assert.match(src, /aria-label="What to build"/, 'the builder select has no accessible name');
});

test('the page heading level does not skip', () => {
  // h1 "Dev" was followed by h3, leaving a level missing in the outline. uk-h3 keeps the size
  // the design asks for: the LEVEL is structure, the class is appearance.
  assert.match(src, /<h2 class="uk-h3 uk-margin-remove">What would you like to create\?<\/h2>/, 'the build heading skipped back to h3');
});

test('checkboxes and radios show a focus ring', () => {
  // UIKit draws none, so this was the one control a keyboard user could land on without
  // seeing where they were.
  assert.match(css, /\.uk-checkbox:focus-visible/, 'checkbox focus ring removed');
  assert.match(css, /\.uk-radio:focus-visible/, 'radio focus ring removed');
});

test('motion is guarded where it is used', () => {
  // Three animations exist: the waiting badge, the mic while listening, and the skip link.
  const guards = (css.match(/prefers-reduced-motion/g) || []).length;
  assert.ok(guards >= 3, `only ${guards} reduced-motion guards for the animations in use`);
});


// ---------------------------------------------------------------------------
// What an axe run over every page (light and dark, 36 combinations) found, and what must not come
// back. Each of these was a real violation, not a hypothetical.

test('no component fades text with opacity', () => {
  // Every contrast failure but one came from the same habit: taking a token that was checked and
  // dimming it again. --text-subtle at 75% on the dark rail is 4.4:1; brand blue at 60% on white is
  // 2.42:1. Quiet is the token's job. Opacity on a whole control (a disabled pager arrow, a drag
  // handle, a card being dragged) is fine — this is about opacity on a run of text.
  const files = fs.readdirSync(path.join(APP, 'public', 'css', 'components'));
  const offenders = [];
  for (const f of files) {
    // Comments first: they quote the very colours and opacities this is about.
    const text = fs.readFileSync(path.join(APP, 'public', 'css', 'components', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // One rule at a time — a selector, then what it declares. A rule that sets BOTH a colour and a
    // fractional opacity is the shape that keeps biting.
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = m;
      if (/opacity:\s*0?\.\d/.test(body) && /(^|[\s;])color:\s*var\(--/.test(body)) {
        offenders.push(`${f}: ${selector.trim().split('\n').pop().slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'set a quieter token, do not fade a checked one');
});

test('the root element carries the page colour, and a short page fills the window', () => {
  const base = fs.readFileSync(path.join(APP, 'public', 'css', 'base.css'), 'utf8');
  // <html> was left at the browser's white while <body> went dark: the strip under a short page and
  // the overscroll bounce both showed it.
  assert.match(base, /html \{ background: var\(--surface\); min-height: 100%; \}/);
  assert.match(base, /body \{ min-height: 100vh; \}/);
  assert.match(base, /html\.dark \{ color-scheme: dark; \}/, 'so form controls and scrollbars follow too');
});

test('keyboard focus is visible everywhere, not just where someone remembered it', () => {
  const base = fs.readFileSync(path.join(APP, 'public', 'css', 'base.css'), 'utf8');
  assert.match(base, /:focus-visible \{\s*\n\s*outline: 2px solid var\(--brand-primary\)/,
    'there was no global focus style at all — the browser default is a dark dotted box');
  // :focus-visible, not :focus: a mouse click must not draw a ring nobody asked for.
  assert.ok(!/[^-]:focus \{[\s\S]{0,80}outline: 2px solid/.test(base), 'use :focus-visible');
});

test('a card does not turn white under the cursor in dark mode', () => {
  const cards = fs.readFileSync(path.join(APP, 'public', 'css', 'components', 'workspace-cards.css'), 'utf8');
  // UIKit paints .uk-card-default.uk-card-hover:hover white — two classes, and its stylesheet is
  // linked after ours, so a single-class rule of ours lost the tie.
  assert.match(cards, /\.uk-card-default\.uk-card-hover:hover[\s\S]*?background-color: var\(--surface-card\)/);
  assert.match(cards, /\.workspace-card:focus-visible/, 'and a card is a link: it needs a ring');
});

test('every select the item rows render has a name', () => {
  // 42 unnamed <select> on /ai-skills: a screen reader announced "combo box" forty-two times.
  const rows = src.slice(src.indexOf('class="install-target"'), src.indexOf('class="install-target"') + 900);
  assert.match(rows, /name="toWorkspace" aria-label="Install into: which workspace"/);
  assert.match(rows, /name="toProject" aria-label="Install into: which project"/);
});

test('the help page code blocks can be reached by keyboard', () => {
  // pandoc writes <pre> that scrolls; a scrollable region with nothing focusable in it is a dead end.
  assert.match(src, /replace\(\/<pre\(\?!\[\^>\]\*tabindex\)\/g, '<pre tabindex="0"'\)/);
});

test('deep-chat’s own buttons are named', () => {
  const ui = fs.readFileSync(path.join(APP, 'public', 'ui.js'), 'utf8');
  // They live in the component's shadow root with role="button" and an SVG inside, so they are named
  // from our side rather than by forking the vendored bundle.
  assert.match(ui, /const nameChatButtons/);
  assert.match(ui, /'#microphone-button', 'Dictate the message'/);
  assert.match(ui, /aria-label', label/);
});
