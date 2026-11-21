/**
 * The test report lists a failed run's evidence: its screenshots, page dumps, recordings and PDFs (webship/workspace#677).
 *
 * artifactIsEmpty(), which drops a blank screenshot and a recording too short to show anything, stayed in server.js
 * when the report's lookup moved into test-reports.js; every call threw, sideFiles() caught it and returned nothing,
 * so the report listed no screenshot, recording or PDF at all. It lives in artifact-empty.js now. This builds a failed
 * run's evidence and checks what the lookup keeps and what it drops.
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { findTestReports } = require('../../test-reports');
const { artifactIsEmpty } = require('../../artifact-empty');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-report-evidence-'));
after(() => fs.rmSync(ws, { recursive: true, force: true }));

// An 8-bit RGB PNG, white, with one dark pixel when `odd` (the reader checks no CRC).
const png = (w, h, odd) => {
  const rows = [];
  for (let y = 0; y < h; y += 1) {
    const row = Buffer.alloc(1 + w * 3, 255);
    row[0] = 0;
    if (odd && y === 1) row.fill(0, 1 + 3, 1 + 6);
    rows.push(row);
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};
// A webm whose EBML Duration says `ms` milliseconds (the default TimecodeScale).
const webm = (ms) => { const d = Buffer.alloc(8); d.writeDoubleBE(ms); return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x44, 0x89, 0x88]), d, Buffer.alloc(64)]); };

const p = path.join(ws, 'wp1', 'tests');
const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(p, rel)), { recursive: true }); fs.writeFileSync(path.join(p, rel), data); };
put('reports/cucumber_report.json', JSON.stringify([{ uri: 'tests/features/site.feature', name: 'The site', elements: [{ name: 'The front page', type: 'scenario', steps: [{ keyword: 'Then ', name: 'I should see "Hello"', result: { status: 'failed' } }] }] }]));
put('reports/cucumber_report.html', '<html><body>report</body></html>');
put('reports/run.pdf', '%PDF-1.4\n%%EOF\n');
put('screenshots/The_front_page_FAILED.png', png(8, 8, true));
put('screenshots/blank_FAILED.png', png(8, 8, false));
put('screenshots/The_front_page_FAILED.html', '<html><head><title>x</title></head><body><h1>Error establishing a database connection</h1></body></html>');
put('screenshots/blank_FAILED.html', '<html><head></head><body></body></html>');
put('videos/The_front_page.webm', webm(5000));
put('videos/first_step.webm', webm(1000));

test('a failed run\'s screenshot, page dump, recording and PDF are listed; the blank and too-short ones are not', () => {
  const [r] = findTestReports(ws, 'wp1');
  assert.ok(r, 'the report is found');
  assert.deepStrictEqual(r.shots.map((f) => f.name), ['The_front_page_FAILED.png']);
  assert.deepStrictEqual(r.doms.map((f) => f.name), ['The_front_page_FAILED.html']);
  assert.deepStrictEqual(r.videos.map((f) => f.name), ['The_front_page.webm']);
  assert.deepStrictEqual(r.pdfs.map((f) => f.name), ['run.pdf']);
});

test('artifactIsEmpty judges by the bytes: one colour, or two seconds or less, is empty; what it cannot read is kept', () => {
  const at = (rel) => { const full = path.join(p, rel); const st = fs.statSync(full); return artifactIsEmpty(full, path.basename(rel), st.size, st.mtimeMs); };
  assert.strictEqual(at('screenshots/blank_FAILED.png'), true);
  assert.strictEqual(at('screenshots/The_front_page_FAILED.png'), false);
  assert.strictEqual(at('videos/first_step.webm'), true);
  assert.strictEqual(at('videos/The_front_page.webm'), false);
  put('screenshots/odd.png', Buffer.from('not a png at all, but not empty either'));
  assert.strictEqual(at('screenshots/odd.png'), false, 'a file it cannot read is evidence: kept');
});

test('server.js keeps none of it; test-reports.js asks artifact-empty.js', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  assert.doesNotMatch(read('server.js'), /function (artifactIsEmpty|pngIsUniform|videoSeconds)\b/);
  assert.match(read('test-reports.js'), /const \{ artifactIsEmpty \} = require\('\.\/artifact-empty'\);/);
});
