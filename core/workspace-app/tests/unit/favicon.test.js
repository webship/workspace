/**
 * The favicon, asserted on the artwork rather than on the page.
 *
 * The page's link tags are checked in the browser suite; what cannot be checked there is the file
 * itself — a browser handed an icon renders it as an image, so there is no text to read and a
 * navigation to it is not a page. Here it is a file, which is what it is.
 *
 * Why any of this is worth a test: the favicon is the one piece of brand that appears in a place we
 * do not control, at 16px, beside example.com's own tab. The dashboard wears the Webship mark, from
 * the product's own image set, and ships it as PNGs: there is no SVG emblem, so the shipped default
 * must not point at one.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');

// A PNG header carries its dimensions and colour type at fixed offsets; no image library needed.
const png = (f) => {
  const b = fs.readFileSync(path.join(PUBLIC, f));
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${f} is a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colour: b.readUInt8(25) };
};

test('the icons are the sizes the places that use them ask for', () => {
  // 64 for the tab, which browsers scale down from; 180 for the home screen, which iOS asks for exactly.
  const tab = png('favicon.png');
  assert.deepEqual([tab.width, tab.height], [64, 64], 'the tab icon');
  const touch = png('touch-icon.png');
  assert.deepEqual([touch.width, touch.height], [180, 180], 'the home-screen icon');
});

test('the home-screen icon carries no alpha, because it lands on somebody\'s wallpaper', () => {
  // A knocked-out mark over a wallpaper is whatever the wallpaper is. Asserted on the IHDR colour
  // type, which is the fact and not a proxy for it: byte 25 of a PNG is 2 for RGB and 6 for RGBA,
  // so 2 means there is no transparency left to get wrong.
  assert.equal(png('touch-icon.png').colour, 2, 'touch-icon.png still has an alpha channel — flatten it');
});

test('the one logo serves both surfaces, and the legacy .ico is there for what asks for it by name', () => {
  // One logo for the light page and the dark one: the mark reads on either, so there is no second file
  // to drift from the first. favicon.ico is what an old client fetches without reading the page.
  const logo = png('logo.png');
  assert.ok(logo.width >= 180 && logo.width === logo.height, 'the mark is square and large enough to scale down');
  const ico = fs.readFileSync(path.join(PUBLIC, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'favicon.ico is an ICO');
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1, 'with at least one image in it');
});

test('the shipped default is the PNGs, with no SVG to point at', () => {
  const { styleSettings } = require('../../workspaces');
  const style = styleSettings();
  assert.equal(style.faviconSvg, '', 'an empty SVG means no <link rel="icon" type="image/svg+xml"> at all');
  assert.equal(style.faviconPng, 'favicon.png');
  assert.equal(style.touchIcon, 'touch-icon.png');
  assert.equal(style.logoOnLight, 'logo.png');
  assert.equal(style.logoOnDark, 'logo.png');
  for (const f of [style.faviconPng, style.touchIcon, style.logoOnLight]) {
    assert.ok(fs.existsSync(path.join(PUBLIC, f)), `${f} ships with the dashboard`);
  }
  // And the page only writes the SVG tag when there is an SVG to write.
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(server, /\$\{style\.faviconSvg \? `<link rel="icon" type="image\/svg\+xml"[^`]*` : ''\}/);
});
