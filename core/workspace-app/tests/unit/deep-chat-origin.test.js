/**
 * The assistant's route is an action like any other: a request from another site is refused before anything reads its
 * body, and only JSON is taken. It used to be handled above the same-origin check and return before reaching it, and
 * the assistant it starts can use Bash — so a page on any site could hand it a prompt.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

test('the assistant route refuses another site before it reads the body, and takes only JSON', () => {
  const at = src.indexOf("pathname === '/actions/deep-chat'");
  assert.ok(at > 0, 'no assistant route');
  const beforeBody = src.slice(at, src.indexOf("req.on('data'", at));
  assert.match(beforeBody, /if \(foreignOrigin\(req\)\) \{[\s\S]*?writeHead\(403/);
  assert.match(beforeBody, /application\\\/json[\s\S]*?writeHead\(415/);
});

test('foreignOrigin: another host is foreign; the same host, and no Origin at all, are not', () => {
  const start = src.indexOf('function foreignOrigin(req) {');
  const fn = src.slice(start, src.indexOf('\n}\n', start) + 2);
  const foreignOrigin = new Function(`${fn}; return foreignOrigin;`)();
  const req = (origin, host = 'workspace.ddev.site') => ({ headers: { origin, host } });
  assert.strictEqual(foreignOrigin(req('https://evil.example')), true);
  assert.strictEqual(foreignOrigin(req('https://workspace.ddev.site.evil.example')), true);
  assert.strictEqual(foreignOrigin(req('not a url')), true);
  assert.strictEqual(foreignOrigin(req('https://workspace.ddev.site')), false);
  assert.strictEqual(foreignOrigin(req(undefined)), false);
});

test('every other action keeps the same check', () => {
  const at = src.indexOf("req.method === 'POST' && pathname.startsWith('/actions/')");
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 900), /if \(foreignOrigin\(req\)\) \{/);
});
