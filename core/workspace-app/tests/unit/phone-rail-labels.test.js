'use strict';
// Stacked above the page (phones, tablets) the actions rail shows its labels again. A collapsed rail
// kept every button a 36px square, so the labels were drawn over one another.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public/css/components/full-height-right-actions-rail-pages-that-have-actions.css'), 'utf8');
const stacked = css.slice(css.indexOf('@media (max-width: 59.9375em)'));

test('stacked, a collapsed rail gives its buttons back the room for their labels', () => {
  assert.match(stacked, /html\.actions-collapsed \.actions-group-label \{ display: inline; \}/, 'the labels are shown');
  const rule = (stacked.match(/html\.actions-collapsed \.actions-side \.action-btn \{([^}]*)\}/) || [])[1] || '';
  assert.match(rule, /width: auto;/);
  assert.match(rule, /min-width: 0;/);
  assert.match(rule, /height: auto;/);
  assert.match(rule, /padding:0 0\.75rem;/);
});

test('the navigation group stays icon-only: its rule comes after the labelled one', () => {
  const labelled = stacked.indexOf('html.actions-collapsed .actions-side .action-btn {');
  const nav = stacked.indexOf('html.actions-collapsed .actions-nav .action-btn {');
  assert.ok(labelled > -1 && nav > labelled);
});
