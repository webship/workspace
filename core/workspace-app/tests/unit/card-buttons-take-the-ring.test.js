/**
 * A project card's controls show focus with the ring every other control has (round 7: a 1.65:1 halo).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'public', 'css');
const cards = fs.readFileSync(path.join(dir, 'components', 'project-cards.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const base = fs.readFileSync(path.join(dir, 'base.css'), 'utf8');

test('the card\'s focus is the link-coloured outline, not the halo', () => {
  const rule = cards.match(/\.pcard :is\(a, button\):focus-visible \{([^}]*)\}/);
  assert.ok(rule, 'the card has its focus rule');
  assert.match(rule[1], /outline: 2px solid var\(--link\);/);
  assert.match(rule[1], /outline-offset: 2px;/);
  assert.doesNotMatch(rule[1], /var\(--focus-ring\)/, 'the halo is 1.65:1 on the light card');
  assert.doesNotMatch(rule[1], /outline: 0/);
});

test('the state chip on a card takes the same ring', () => {
  assert.match(cards, /\.pcard-status \.state-toggle:focus-visible \{ outline: 2px solid var\(--link\); outline-offset: 1px; \}/);
  assert.doesNotMatch(cards, /outline: 2px solid var\(--subtle-brand\)/, 'the palest brand tint is 1.19:1 on the card');
});

test('it is the ring the rest of the dashboard has', () => {
  assert.match(base, /\.uk-button:focus-visible,[\s\S]*?\{\s*outline: 2px solid var\(--link\);\s*outline-offset: 2px;\s*\}/);
});
