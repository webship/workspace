/**
 * The avatar's browser window reads pages through the dashboard, from inside its container, which can
 * reach the Docker network and every DDEV project. What must never drift: only https pages with a public
 * name are fetched, a redirect is checked like the first address, nothing that can run survives the
 * cleaning, and a bot check is said so rather than worked around.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { serveReader, allowed, privateIp, cleanHtml, isChallenge } = require('../../reader');
const { youtubeId } = require('../../assistant');

const lookupTo = (address) => async () => [{ address }];
const res = () => ({ status: 0, headers: {}, body: '', writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = String(b); } });

test('private, local and container addresses are never fetched', async () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '172.18.0.4', '192.168.1.2', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1']) {
    assert.ok(privateIp(ip), ip);
  }
  assert.ok(!privateIp('140.82.112.3'));
  assert.match(await allowed(new URL('http://example.com/')), /https/);
  assert.match(await allowed(new URL('https://127.0.0.1/')), /names/);
  assert.match(await allowed(new URL('https://dev.workspace.ddev.site/')), /own tab/);
  assert.match(await allowed(new URL('https://example.com:8080/')), /port/);
  assert.match(await allowed(new URL('https://intranet.example.com/'), lookupTo('10.1.2.3')), /not a public/);
  assert.strictEqual(await allowed(new URL('https://example.com/'), lookupTo('93.184.216.34')), '');
});

test('a redirect to a private address is refused like the first one', async () => {
  const r = res();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { status: 302, ok: false, headers: new Map([['location', 'https://internal.example.com/']]) }; };
  const lookup = async (host) => [{ address: host === 'internal.example.com' ? '10.0.0.5' : '93.184.216.34' }];
  await serveReader(r, 'https://example.com/', { fetchImpl, lookup });
  assert.strictEqual(calls, 1, 'the private address is never requested');
  assert.strictEqual(r.status, 403);
  assert.match(r.headers['Content-Security-Policy'], /default-src 'none'/);
});

test('nothing that can run survives, and links stay in the reader', () => {
  const html = `<main><h1 onclick="x()">Docs</h1><script>alert(1)</script><iframe src="https://evil"></iframe>
    <a href="/guide">Guide</a> <a href="javascript:alert(1)">bad</a> <img src="/a.png" onerror="x()" alt="A">
    <form action="/x"><input name="q"></form><p style="position:fixed">text</p></main>`;
  const out = cleanHtml(html, 'https://docs.example.com/start');
  assert.ok(!/<script|<iframe|<form|<input|onclick|onerror|style=|javascript:/i.test(out), out);
  assert.match(out, /href="\/fragments\/reader\?u=https%3A%2F%2Fdocs\.example\.com%2Fguide"/);
  assert.match(out, /<img src="https:\/\/docs\.example\.com\/a\.png" alt="A"/);
});

test('a bot check is recognised, never worked around', () => {
  assert.ok(isChallenge('<html><head><title>Client Challenge</title></head></html>'));
  assert.ok(isChallenge('<title>Just a moment...</title>'));
  assert.ok(!isChallenge('<title>Webship | Drupal.org</title>'));
});

test('only a real YouTube video link becomes a video', () => {
  assert.strictEqual(youtubeId('https://www.youtube.com/watch?v=ubA5ioet_S8'), 'ubA5ioet_S8');
  assert.strictEqual(youtubeId('https://youtu.be/ubA5ioet_S8'), 'ubA5ioet_S8');
  assert.strictEqual(youtubeId('https://www.youtube.com/shorts/ubA5ioet_S8'), 'ubA5ioet_S8');
  assert.strictEqual(youtubeId('https://evil.example.com/watch?v=ubA5ioet_S8'), null);
  assert.strictEqual(youtubeId('https://www.youtube.com/watch?v=short'), null);
});
