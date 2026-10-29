/**
 * The Screens icon in the top bar, and the terminals icon beside it.
 *
 * UIKit's `tv` is a 1px hairline on a 20-unit grid. The top bar renders it at 16px — a 0.8 scale — so
 * the stroke lands between pixels and comes out soft, and differently on different displays: the
 * "sometimes it is not clear" report. Its colour was never the problem; measured, it takes the
 * button's own at 4.98:1 in light and 6.30:1 in dark.
 *
 * Tabler is the set every other icon in this dashboard uses, its stroke is set in CSS (1.75) rather
 * than baked into the shape, and the Screens PAGE already heads itself with this same icon — so the
 * same thing now looks the same in both places.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const sprite = fs.readFileSync(path.join(__dirname, '../../public/vendor/tabler-sprite.svg'), 'utf8');

test('the Screens button uses the same icon as the Screens page', () => {
  // Sliced to the END of the entry rather than a byte count: a comment added inside it should not
  // decide whether this test can see the icon.
  const from = server.indexOf("id: 'open-screens'");
  const entry = server.slice(from, server.indexOf('},', server.indexOf('action-label">Screens', from)));
  assert.match(entry, /iconHtml\('tabler:device-tv', 0\.8\)/);
  assert.doesNotMatch(entry, /uk-icon="icon: tv/, 'the hairline one is gone');
  // The page heading it now matches.
  assert.match(server, /tabler:device-tv/);
});

test('the terminals icon beside it matches', () => {
  // They sit side by side; one Tabler and one UIKit next to each other reads as a mistake.
  const from = server.indexOf("id: 'terminals'");
  const entry = server.slice(from, server.indexOf('},', server.indexOf('term-close-all', from)));
  assert.match(entry, /iconHtml\('tabler:device-laptop', 0\.8\)/);
  assert.doesNotMatch(entry, /uk-icon="icon: laptop/);
});

test('both icons are really in the vendored sprite', () => {
  // An icon name the sprite does not carry renders an empty box — that is how `commands` shipped with
  // `terminal` and drew nothing.
  for (const id of ['device-tv', 'device-laptop']) {
    assert.ok(sprite.includes(`id="${id}"`), `${id} is in the sprite`);
  }
});
