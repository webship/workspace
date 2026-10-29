/**
 * The favicon, asserted on the artwork rather than on the page.
 *
 * The page's link tags are checked in the browser suite; what cannot be checked there is the file
 * itself — a browser handed an SVG renders it as an image, so there is no text to read and a
 * navigation to it is not a page. Here it is a file, which is what it is.
 *
 * Why any of this is worth a test: the favicon is the one piece of brand that appears in a place we
 * do not control, at 16px, beside vardot.com's own tab. It has to be the artwork from the VDT
 * Stylesheet and it has to stay distinguishable.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

test('the favicon is the artwork itself: one path, the emblem subtracted from a square', () => {
  const svg = read('vardot-favicon.svg');
  assert.match(svg, /viewBox="0 0 30 30"/);
  // ONE shape, not a square with a mark drawn on top. The counter and the crescent bite on the left
  // edge are knocked out of the square, which is what makes it the design rather than a copy of it.
  assert.equal((svg.match(/<path/g) || []).length, 1, 'the boolean shape is a single path');
  assert.ok(!/<rect/.test(svg), 'no separate tile: the square IS the path');
  assert.match(svg, /fill-rule="evenodd"/, 'the subtract needs the even-odd rule to leave holes');
  // The bite reaches x=0, so the mark runs off the left edge — that is the tell that this is the
  // subtracted artwork and not the emblem placed inside a tile.
  assert.match(svg, / d="M30 30H0/);
});

test('the fill follows the viewer, because a knocked-out mark has no colour of its own', () => {
  const svg = read('vardot-favicon.svg');
  // Type=Dark is the variant for a light surface. On a dark tab strip the transparent counter goes
  // dark and the bitten edge merges into the strip, so the fill flips — which is what the Light
  // variant of this component set is for.
  assert.match(svg, /\.mark \{ fill: #0074E0; \}/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\) \{ \.mark \{ fill: #FFFFFF; \} \}/);
  assert.match(svg, /class="mark"/);
});

test('it says where it came from, so it can be refreshed from the same place', () => {
  const svg = read('vardot-favicon.svg');
  assert.match(svg, /figma\.com\/design\/Hwbkgkvxths84swEtWcmTv/);
  assert.match(svg, /5743:11748/, 'the node the artwork was taken from');
  assert.match(svg, /Type=Dark, Logo=Emblem Square/, 'and which variant of it');
});

test('the alternative is the same artwork on the secondary, for when the two would collide', () => {
  const alt = read('webship-workspace-favicon.svg');
  assert.match(alt, /\.mark \{ fill: #2B447C; \}/);
  assert.ok(!alt.includes('#0074E0'), 'and not the primary as well');
  // Same geometry: one colour changed, not a second drawing.
  const shape = (s) => s.match(/ d="([^"]+)"/)[1];
  assert.equal(shape(alt), shape(read('vardot-favicon.svg')));
});

test('the PNG fallbacks carry no alpha at all, because neither can carry the media query', () => {
  // A PNG has no @media. Left blue-on-transparent it would put a dark counter on a dark tab strip
  // with nothing to flip, and a home-screen icon would be a knocked-out mark on somebody's
  // wallpaper. Both are flattened over white — the one form that reads on any surface.
  //
  // Asserted on the IHDR colour type, which is the fact and not a proxy for it: byte 25 of a PNG is
  // 2 for RGB and 6 for RGBA, so 2 means there is no transparency left to get wrong.
  for (const f of ['vardot-favicon.png', 'vardot-touch-icon.png']) {
    const b = fs.readFileSync(path.join(PUBLIC, f));
    assert.equal(b.readUInt8(25), 2, `${f} still has an alpha channel — flatten it over white`);
  }
});

test('the PNG fallbacks are the sizes the two places that use them ask for', () => {
  // A PNG header carries its dimensions at a fixed offset; no image library needed for this.
  const dims = (f) => {
    const b = fs.readFileSync(path.join(PUBLIC, f));
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  assert.deepEqual(dims('vardot-favicon.png'), [32, 32], 'the tab icon');
  assert.deepEqual(dims('vardot-touch-icon.png'), [180, 180], 'the home-screen icon');
});

test('the shipped default points at the SVG, with the PNG only as the fallback', () => {
  const { styleSettings } = require('../../workspaces');
  const style = styleSettings();
  assert.equal(style.faviconSvg, 'vardot-favicon.svg');
  assert.equal(style.faviconPng, 'vardot-favicon.png');
  assert.equal(style.touchIcon, 'vardot-touch-icon.png');
});
