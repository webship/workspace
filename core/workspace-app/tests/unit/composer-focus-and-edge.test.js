/**
 * The AI Assistant's message field has a 3:1 edge and shows focus (round 7: nothing changed on focus, the edge
 * was --line, 1.35:1). It is styled inside deep-chat's shadow root, from ui.js.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ui.js'), 'utf8');
const base = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'base.css'), 'utf8');
const aux = ui.slice(ui.indexOf('el.auxiliaryStyle = `'), ui.indexOf('`;', ui.indexOf('el.auxiliaryStyle = `')));

test('the composer\'s edge is the same 3:1 mix every field has', () => {
  const mix = 'color-mix(in srgb, var(--text-subtle) 70%, var(--surface-card))';
  assert.ok(base.includes(`border-color: ${mix};`), 'the fields\' own edge (base.css)');
  assert.match(aux, /#text-input-container \{ background-color: var\(--surface-input\) !important; border: 1px solid color-mix\(in srgb, var\(--text-subtle\) 70%, var\(--surface-card\)\) !important; \}/);
  assert.doesNotMatch(aux, /#text-input-container \{[^}]*border: 1px solid var\(--line\)/);
});

test('while it holds focus, its border and a ring take the link colour', () => {
  assert.match(aux, /#text-input-container:focus-within \{ border-color: var\(--link\) !important; outline: 2px solid var\(--link\); outline-offset: 2px; \}/);
});
