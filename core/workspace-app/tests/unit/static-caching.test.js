const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const serveStatic = src.slice(src.indexOf('function serveStatic'), src.indexOf('function serveStatic') + 2600);

// Static assets were served with a Content-Type and nothing else: no Cache-Control, no ETag, no
// Last-Modified. With no validator a browser has nothing to revalidate against, so it refetched
// them — 300 KB gzipped per visit, the 1.4 MB Tabler sprite included. A repeat visit now costs
// zero bytes. None of that is visible in the UI, which is why it needs a test.
test('static assets carry a validator and a cache policy', () => {
  for (const h of ['ETag', 'Last-Modified', 'Cache-Control']) {
    assert.ok(serveStatic.includes(h), `serveStatic no longer sets ${h}`);
  }
});

test('a versioned URL is immutable, an unversioned one revalidates', () => {
  // assetUrl appends ?v=<mtime>, so when the file changes the URL changes and a stale copy is
  // unreachable rather than merely old. Anything without that must not be frozen for a year.
  assert.ok(serveStatic.includes('immutable'), 'versioned assets are no longer immutable');
  assert.ok(serveStatic.includes('must-revalidate'), 'unversioned assets no longer revalidate');
  assert.match(serveStatic, /\[?\?&\]v=|v=/, 'no longer distinguishes versioned URLs');
});

test('a conditional request is answered 304 with no body', () => {
  assert.ok(serveStatic.includes('304'), 'conditional requests are no longer answered 304');
  assert.ok(/if-none-match/i.test(serveStatic), 'If-None-Match is no longer honoured');
  assert.ok(/if-modified-since/i.test(serveStatic), 'If-Modified-Since is no longer honoured');
});

test('HEAD is routed with GET, and sends no body', () => {
  // HEAD used to fall through to 405, which broke curl -I and any uptime check.
  assert.match(src, /req\.method === 'GET' \|\| req\.method === 'HEAD'/,
    'HEAD is no longer routed with GET');
  assert.ok(serveStatic.includes("req.method === 'HEAD'"), 'serveStatic no longer skips the body for HEAD');
});
