const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const ui = app('public/ui.js');
const css = app('public/css/components/working-indicators.css');

test('the Send button shows three animated dots while the assistant works, in place of the arrow', () => {
  assert.ok(ui.includes(':host([data-assistant-working]) .input-button.inside-end::after'));
  assert.ok(ui.includes('animation: ws-dots 1.2s ease-in-out infinite;'));
  assert.ok(ui.includes(':host([data-assistant-working]) .input-button.inside-end svg { opacity: 0; }'));
  assert.equal((ui.match(/radial-gradient\(circle, var\(--text-inverse\) 2\.4px/g) || []).length, 3, 'three dots, in the theme token and not a colour');
});

test('deep-chat\'s own dots on the button are hidden so only one animation shows', () => {
  assert.ok(ui.includes(':host([data-assistant-working]) .loading-submit-button { display: none !important; }'));
});

test('the dots bounce one after another', () => {
  const frames = ui.slice(ui.indexOf('@keyframes ws-dots'), ui.indexOf('@keyframes ws-dots') + 500);
  const raised = [...frames.matchAll(/(\d+)% \{ background-position: ([^;]+);/g)].filter((m) => m[1] !== '0').map((m) => m[2].split(',').map((p) => p.trim()).findIndex((p) => p.endsWith('30%')));
  assert.deepEqual(raised.filter((i) => i >= 0), [0, 1, 2]);
});

test('the panel header pulses the avatar and sweeps a light while it works', () => {
  assert.ok(css.includes('.assistant-panel[data-working] .assistant-head::after'));
  assert.ok(css.includes('.assistant-panel[data-working] .assistant-avatar { animation: assistant-pulse'));
  assert.ok(css.includes('@keyframes assistant-sweep') && css.includes('@keyframes assistant-pulse'));
});

test('motion is switched off for people who prefer reduced motion', () => {
  assert.ok(ui.includes('@media (prefers-reduced-motion: reduce) { :host([data-assistant-working]) .input-button.inside-end::after { animation: none; } }'));
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.assistant-panel\[data-working\] \.assistant-head::after,\s*\.assistant-panel\[data-working\] \.assistant-avatar \{ animation: none; \}/);
});

test('working starts when a message is sent and ends on the answer, a reply of any kind, an error, or after a time limit', () => {
  assert.ok(ui.includes("if (message.role === 'user') { conversationEmpty = false; narrator.cancel(); playSendAnimation(); setWorking(true); }"));
  assert.ok(ui.includes('else setWorking(false);'), 'an assistant message ends it');
  assert.ok(ui.includes('el.onError = () => setWorking(false, true);'), 'an error ends it, and says it failed');
  assert.ok(ui.includes('    setWorking(false);\n    if (response && response.html)'), 'the response interceptor ends it');
  assert.ok(ui.includes('setTimeout(() => setWorking(false), 16 * 60 * 1000)'), 'a request that never answers cannot leave it running for ever');
});

test('the state is on the panel and the chat, so both the page and the shadow styles can read it', () => {
  assert.ok(ui.includes("el.toggleAttribute('data-assistant-working', on)"));
  assert.ok(ui.includes("document.querySelectorAll('.assistant-panel').forEach((p) => p.toggleAttribute('data-working', on))"));
});
