/**
 * The "waiting" badge pulses without fading its own words, and stops (round 7: 4.4:1 at the dip, forever).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'components', 'project-rows.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('the pulse is a ring, not the label fading', () => {
  const frames = css.slice(css.indexOf('@keyframes hand-wave'), css.indexOf('}\n}', css.indexOf('@keyframes hand-wave')) + 3);
  assert.doesNotMatch(frames, /opacity/, 'the words keep their contrast');
  assert.match(frames, /box-shadow: 0 0 0 0\.25rem color-mix\(in srgb, var\(--warning\) 55%, transparent\)/);
});

test('it beats three times and stops, and not at all with reduced motion', () => {
  assert.match(css, /\.screens-waiting \{ animation: hand-wave 1\.6s ease-in-out 3; \}/, 'under five seconds');
  assert.doesNotMatch(css, /hand-wave[^;]*infinite/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.screens-waiting \{ animation: none; \}/);
});
