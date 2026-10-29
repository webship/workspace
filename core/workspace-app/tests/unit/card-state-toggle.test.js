'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../public/css/components/project-cards.css'), 'utf8');

test('the state chip on a card switches the project: Stopped and Paused start it, Running stops it', () => {
  assert.match(server, /const act = st === 'running' \? 'Stop' : 'Start';/);
  assert.match(server, /hx-post="\/actions\/ddev-\$\{act\.toLowerCase\(\)\}"/);
  assert.match(server, /<button type="button" class="uk-label \$\{cls\} state-chip state-toggle/);
});

test('stopping from the chip goes through the confirm dialog; starting does not', () => {
  assert.match(server, /state-toggle\$\{st === 'running' \? ' arm-step' : ''\}/);
  assert.match(server, /\$\{st === 'running' \? ' hx-trigger="confirmed-remove"' : ''\}/);
});

test('a DDEV state other than these three is shown, not offered as a switch', () => {
  assert.match(server, /if \(!st\) return `<span class="uk-label state-chip state-chip-off">/);
});

test('hovering the chip says what a click does, and Paused has its own colour and stripe', () => {
  assert.match(css, /\.state-toggle:is\(:hover, :focus-visible\) \.state-act \{ visibility: visible; \}/);
  assert.match(css, /\.state-chip-paused \{ background: var\(--warning-soft\); color: var\(--warning-ink\);/);
  assert.match(css, /\.project-row\.pcard:has\(\.state-chip-paused\) \{ --pcard-stripe: var\(--warning\); \}/);
});
