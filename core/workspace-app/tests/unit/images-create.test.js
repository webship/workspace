const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const create = require('../../images-create');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('an upload is an image by its bytes, not by its name', () => {
  assert.equal(create.sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(create.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(create.sniff(Buffer.from('GIF89a......')), 'gif');
  assert.equal(create.sniff(Buffer.from('RIFF....WEBPVP8 ')), 'webp');
  assert.equal(create.sniff(Buffer.from('....ftypavif....')), 'avif');
  assert.equal(create.sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(create.sniff(Buffer.from('#!/bin/sh\nrm -rf /')), '');
  assert.equal(create.sniff(Buffer.from('<html><svg></svg></html>')), '');
  assert.equal(create.MAX_UPLOAD, 25 * 1024 * 1024);
});

test('an upload or a screenshot only ever lands inside the images workspace', () => {
  assert.equal(create.targetDir('../dev'), null);
  assert.equal(create.targetDir('a/../../etc'), null);
  assert.equal(create.targetDir('.hidden'), null);
  assert.equal(create.targetDir('ok;rm -rf'), null);
});

test('an edit is ImageMagick argv from fixed lists and checked numbers, saved under a new name', () => {
  const dir = '/tmp/x';
  const src = '/tmp/x/shot.png';
  const crop = create.editArgs(src, dir, { crop: '16:9', width: '800', format: 'webp', quality: '70' }, { width: 1600, height: 1000 });
  assert.deepEqual(crop.args, [`${src}[0]`, '-auto-orient', '-gravity', 'center', '-crop', '1600x900+0+0', '+repage',
    '-resize', '800x', '-quality', '70', 'webp:/tmp/x/shot-v2.webp']);
  assert.equal(crop.changed, true);
  const tall = create.editArgs(src, dir, { crop: '1:1' }, { width: 1600, height: 1000 });
  assert.ok(tall.args.includes('1000x1000+0+0'));
  const junk = create.editArgs(src, dir, { width: '9999999', format: 'exe', crop: '; rm', quality: '500' }, { width: 10, height: 10 });
  assert.equal(junk.changed, false);
  assert.ok(!junk.args.some((a) => /rm|exe|9999999/.test(a)));
  const jpg = create.editArgs(src, dir, { format: 'jpg', quality: '500' }, null);
  assert.ok(jpg.args.includes('-quality') && jpg.args.includes('85'));
});

test('upload, screenshot and edit are wired, with the upload on its own binary route', () => {
  const server = read('server.js');
  assert.match(server, /pathname === '\/actions\/image-upload' && isValidWorkspace\('images'\)\) \{\n\s+if \(foreignOrigin\(req\)\)/);
  const actions = read('actions/images.js');
  assert.match(actions, /'\/actions\/image-screenshot': image_screenshot/);
  assert.match(actions, /'\/actions\/image-edit': image_edit/);
  const page = read('images-page.js');
  assert.match(page, /btn\('primary', 'upload', 'Upload images'/);
  assert.match(page, /btn\('default', 'tabler:camera', 'Screenshot a page'/);
  const ui = read('public/ui.js');
  assert.match(ui, /fetch\(`\/actions\/image-upload\?path=\$\{encodeURIComponent\(folder\)\}&name=\$\{encodeURIComponent\(f\.name\)\}`/);
  assert.match(create.screenshotFormHtml(), /name="width"/);
  assert.match(create.editFormHtml('a.png'), /Save as a new file/);
});
