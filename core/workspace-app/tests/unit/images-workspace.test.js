const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const images = require('../../images');

const root = path.join(__dirname, '..', '..');
const repo = path.join(root, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function gif(w, h) { const b = Buffer.alloc(13); b.write('GIF89a'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; }
function jpeg(w, h) {
  // SOI, an APP0 segment, then SOF0 with height and width.
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03])]);
}
function webp8x(w, h) {
  const b = Buffer.alloc(30); b.write('RIFF'); b.write('WEBP', 8); b.write('VP8X', 12);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
}

test('dimensions are read from each format\'s own header', () => {
  const p = images._parsers;
  assert.deepEqual(p.pngSize(png(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(p.gifSize(gif(64, 32)), { width: 64, height: 32 });
  assert.deepEqual(p.jpegSize(jpeg(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(p.webpSize(webp8x(1600, 1000)), { width: 1600, height: 1000 });
  assert.deepEqual(p.svgSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>')), { width: 120, height: 40 });
  assert.deepEqual(p.svgSize(Buffer.from('<svg width="24px" height="16" viewBox="0 0 1 1">')), { width: 24, height: 16 });
  assert.equal(p.pngSize(Buffer.from('not a png at all, really not')), null);
});

test('a folder lists its folders and images, and nothing outside it', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
  try {
    fs.mkdirSync(path.join(ws, 'shots'));
    fs.writeFileSync(path.join(ws, 'a.png'), png(10, 20));
    fs.writeFileSync(path.join(ws, 'shots', 'b.gif'), gif(3, 4));
    fs.writeFileSync(path.join(ws, 'notes.md'), '# not an image');
    fs.writeFileSync(path.join(ws, '.hidden.png'), png(1, 1));
    const top = images.listFolder(ws, '');
    assert.deepEqual(top.images.map((i) => [i.name, i.width, i.height, i.type]), [['a.png', 10, 20, 'png']]);
    assert.deepEqual(top.folders.map((f) => [f.name, f.count]), [['shots', 1]]);
    assert.equal(images.listFolder(ws, 'shots').images[0].rel, 'shots/b.gif');
    assert.equal(images.listFolder(ws, '../etc').ok, false);
    assert.equal(images.safeIn(ws, '../../etc/passwd'), null);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('names are made safe, and a new name never takes an existing one', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
  try {
    assert.equal(images.safeName('../My Shot (1).PNG'), 'My-Shot-1.PNG');
    fs.writeFileSync(path.join(ws, 'shot.png'), 'x');
    assert.equal(images.freeName(ws, 'shot', 'png'), 'shot-2.png');
    assert.equal(images.versionName(ws, 'shot.png', 'webp'), 'shot-v2.webp');
    fs.writeFileSync(path.join(ws, 'shot-v2.png'), 'x');
    assert.equal(images.versionName(ws, 'shot-v2.png', 'png'), 'shot-v3.png');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('"All media images" reads media and doc workspaces and the dashboard screenshots, never sites', () => {
  assert.deepEqual(images.EVERYWHERE, ['images', 'docs', 'videos', 'audio', 'specs', 'designs']);
  for (const site of ['dev', 'test', 'demos', 'sandboxes', 'projects', 'products']) assert.ok(!images.EVERYWHERE.includes(site), site);
  assert.match(images.appShotsDir(), /core\/workspace-app\/docs\/screenshots$/);
  const list = images.scanEverywhere({ fresh: true });
  assert.ok(Array.isArray(list));
  assert.ok(list.every((im) => images.IMAGE_RE.test(im.name) && im.src));
});

test('the workspace is registered before videos, as a media workspace with a gallery', () => {
  const settings = fs.readFileSync(path.join(repo, 'core/config/settings.yml'), 'utf8');
  assert.match(settings, /\n {2}- images\n {2}- videos\n/);
  assert.match(fs.readFileSync(path.join(repo, 'core/config/workspace.images.settings.yml'), 'utf8'), /type: media/);
  assert.match(read('workspaces.js'), /images: +\{ icon: 'tabler:photo', subtitle: 'Images, screenshots and generated pictures', noun: 'image', kind: 'files' \}/);
  assert.match(read('workspace-types.js'), /images: 'media'/);
  assert.match(read('files-browser.js'), /'images'/);
  assert.match(read('.ddev/config.yaml'), /"\*\.images\.workspace"/);
  for (const f of ['README.md', 'AGENTS.md', 'CLAUDE.md']) assert.ok(fs.existsSync(path.join(repo, 'images', f)), f);
  const server = read('server.js');
  assert.match(server, /if \(key === 'images'\) return require\('\.\/images-page'\)\.galleryHtml\(/);
  assert.match(server, /'\.webp': 'image\/webp', '\.avif': 'image\/avif'/);
  assert.match(server, /type === 'image\/svg\+xml' \? \{ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" \}/);
});

test('the gallery and the viewer draw what the list holds, and only the images workspace can rename or delete', () => {
  const page = require('../../images-page');
  const ws = { per: 'all', page: 1, q: '', sort: 'newest', kind: '', scope: 'here' };
  const html = page.galleryHtml(ws, '', { folderDocs: '', openWith: '', viewSwitcher: '<div class="layout-controls"></div>' });
  // The same building blocks the docs and videos lists use: heading with a count, summary, layout switcher, file list.
  assert.match(html, /<div class="cards-head fx-head">/);
  assert.match(html, /<h3 class="uk-margin-remove">Images <span class="uk-badge">\d+<\/span><\/h3>/);
  assert.match(html, /<p class="uk-text-meta fx-summary">/);
  assert.match(html, /<div class="layout-controls"><\/div>/);
  assert.match(html, /<option value="here" selected>This workspace<\/option>/);
  assert.match(html, /<option value="all">All media images<\/option>/);
  assert.match(html, /name="kind" aria-label="Image type"/);
  assert.match(read('lists.js'), /size: +\{ label: 'Largest first', filesOnly: true/);
  const actions = read('actions/images.js');
  assert.match(actions, /images\.safeIn\(workspaceDir\('images'\)/);
  assert.match(actions, /if \(form\.confirm !== 'yes'\) return send/);
  const ui = read('public/ui.js');
  assert.match(ui, /#editor-modal\.uk-open \[data-img-viewer\]/);
});

test('each source has its own share of the scan, and a vector thumbnail is padded, not stretched', () => {
  assert.equal(images.SCAN_MAX, 1000);
  assert.match(read('images.js'), /const full = \(\) => out\.length - start >= SCAN_MAX;/);
  assert.match(read('images-page.js'), /im\.type === 'svg' \? ' is-vector' : ''/);
  const css = read('public/css/components/images.css');
  assert.match(css, /\.img-row \.fx-thumb\.is-vector img \{ object-fit: contain; padding: 1\.25rem;/);
  assert.match(css, /\.img-stage\.is-fit \{ overflow: hidden; \}/);
});

test('an image is a card of the shared file list: thumbnail with its size in the corner, name, meta, View and a menu', () => {
  const page = require('../../images-page');
  const src = read('images-page.js');
  assert.match(src, /<div class="fx-row fx-file has-thumb img-row">/);
  assert.match(src, /<span class="fx-duration fx-dims">/);
  assert.match(src, /<a class="fx-row fx-folder"/);
  assert.match(src, /<div class="file-list img-list">/);
  assert.match(src, /class="uk-button uk-button-default uk-button-small fx-open" title="View/);
  assert.match(read('server.js'), /viewSwitcher: viewSwitcherHtml\('files'\)/);
  assert.equal(typeof page.galleryHtml, 'function');
});

test('a thumbnail fills the card shape and is cropped from the top, so a tall screenshot stays sharp', () => {
  const src = read('images-page.js');
  assert.match(src, /'-thumbnail', `\$\{THUMB_W\}x\$\{THUMB_H\}\^`, '-gravity', 'north',\n\s+'-extent', `\$\{THUMB_W\}x\$\{THUMB_H\}`/);
  assert.match(src, /thumb\?v=2&src=/);
  assert.match(read('images.js'), /folders\.push\(\{ folder: true, name: e\.name, rel: childRel, count, folders: subs,/);
});
