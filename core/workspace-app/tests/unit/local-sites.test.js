/**
 * The reading window and the workspace's own local sites (local-sites.js, reader.js).
 *
 * What must never drift: only a host name of a project of this workspace is a local site; such a page is
 * asked of DDEV's router by a GET with no cookie; every other local or private address is still refused.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectHosts, localSite, fetchLocalSite } = require('../../local-sites');
const { serveReader, allowed } = require('../../reader');

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-sites-'));
  const project = (ws, name, config) => {
    const dir = path.join(root, ws, name);
    fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
    if (config !== null) fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), config);
    return dir;
  };
  project('dev', 'blog1', 'name: blog1\ntype: drupal\n# additional_hostnames:\n#  - never\n');
  project('dev', 'shop', 'name: my-shop\nadditional_hostnames:\n  - admin.my-shop\nadditional_fqdns: ["shop.example.test"]\nproject_tld: example.site\n');
  project('test', 'plain-folder', null);
  fs.mkdirSync(path.join(root, 'test', '.hidden', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', '.hidden', '.ddev', 'config.yaml'), 'name: hidden\n');
  const workspaces = [{ key: 'dev', dir: path.join(root, 'dev') }, { key: 'test', dir: path.join(root, 'test') }, { key: 'gone', dir: path.join(root, 'gone') }];
  return { root, workspaces };
}

test('a local site is a host name of a DDEV project of this workspace, and nothing else', () => {
  const t = tree();
  assert.deepStrictEqual(projectHosts(path.join(t.root, 'dev', 'blog1')), ['blog1.ddev.site'], 'a commented line is not a host name');
  assert.deepStrictEqual(projectHosts(path.join(t.root, 'dev', 'shop')), ['my-shop.example.site', 'admin.my-shop.example.site', 'shop.example.test']);
  assert.deepStrictEqual(projectHosts(path.join(t.root, 'test', 'plain-folder')), [], 'a folder with no DDEV configuration is not a site');
  const opts = { workspaces: t.workspaces };
  assert.deepStrictEqual(localSite('blog1.ddev.site', opts), { workspace: 'dev', project: 'blog1', dir: path.join(t.root, 'dev', 'blog1'), host: 'blog1.ddev.site' });
  assert.strictEqual(localSite('https://MY-SHOP.example.site/user/login?x=1', opts).project, 'shop');
  assert.strictEqual(localSite('shop.example.test', opts).project, 'shop');
  for (const no of ['other.ddev.site', 'hidden.ddev.site', 'workspace.ddev.site', 'dev.workspace.ddev.site', 'ddev-router', 'localhost', '127.0.0.1', 'blog1.ddev.site.evil.example', '', 'not a url://']) {
    assert.strictEqual(localSite(no, opts), null, no);
  }
});

test('the reader allows a local site by its name only: the dashboard itself, the router and private addresses stay refused', async () => {
  const t = tree();
  const local = (host) => localSite(host, { workspaces: t.workspaces });
  const lookupTo = (address) => async () => [{ address, family: 4 }];
  assert.strictEqual(await allowed(new URL('https://blog1.ddev.site/node/1'), lookupTo('127.0.0.1'), { local }), '');
  assert.match(await allowed(new URL('http://blog1.ddev.site/'), undefined, { local }), /https/, 'https only, also for a local site');
  assert.match(await allowed(new URL('https://blog1.ddev.site:8443/'), undefined, { local }), /port/);
  assert.match(await allowed(new URL('https://workspace.ddev.site/'), undefined, { local }), /own tab/, 'the dashboard is not a site to read');
  assert.match(await allowed(new URL('https://other.ddev.site/'), undefined, { local }), /own tab/, 'a project of somewhere else');
  assert.match(await allowed(new URL('https://intranet.example.com/'), lookupTo('10.1.2.3'), { local }), /not a public/);
  assert.match(await allowed(new URL('https://172.18.0.5/'), undefined, { local }), /names/);
  assert.match(await allowed(new URL('https://blog1.ddev.site/'), lookupTo('127.0.0.1')), /own tab/, 'without the workspace\'s say-so nothing local is read');
});

test('a page of a local site is asked of the router by a GET with no cookie, and the certificate is not checked for it', async () => {
  let asked = null;
  const request = (opts, cb) => {
    asked = opts;
    const handlers = {};
    const res = { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, on(ev, fn) { handlers[ev] = fn; return res; }, destroy() {} };
    return { on() { return this; }, end() { cb(res); handlers.data(Buffer.from('<html><title>Blog</title><body><main><h1>Hello</h1></main></body></html>')); handlers.end(); } };
  };
  const r = await fetchLocalSite(new URL('https://blog1.ddev.site/node/1?page=2'), { request, lookup: async () => ({ address: '172.18.0.5' }) });
  assert.strictEqual(asked.method, 'GET');
  assert.strictEqual(asked.path, '/node/1?page=2');
  assert.strictEqual(asked.servername, 'blog1.ddev.site');
  assert.strictEqual(asked.headers.Host, 'blog1.ddev.site');
  assert.strictEqual(asked.rejectUnauthorized, false);
  assert.deepStrictEqual(Object.keys(asked.headers).sort(), ['Accept', 'Host', 'User-Agent'], 'no cookie, no credentials');
  assert.ok(['ddev-router', '127.0.0.1'].includes(asked.host) || asked.host === process.env.WORKSPACE_DDEV_ROUTER);
  assert.strictEqual(r.ok, true);
  assert.match(r.headers.get('Content-Type'), /text\/html/);
  assert.match(await r.text(), /<h1>Hello<\/h1>/);
});

test('the reader shows a local page cleaned like any other, says it is a local site, and follows a redirect only by the same rules', async () => {
  const t = tree();
  const local = (host) => localSite(host, { workspaces: t.workspaces });
  const page = (body, type = 'text/html') => ({ status: 200, ok: true, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? type : null) }, text: async () => body });
  const serve = async (url, fetchLocal, fetchImpl = async () => { throw new Error('the web was asked'); }) => {
    const out = {}; const res = { writeHead(status, h) { out.status = status; out.csp = h['Content-Security-Policy']; }, end(html) { out.html = html; } };
    await serveReader(res, url, { fetchImpl, lookup: async () => [{ address: '93.184.216.34', family: 4 }], local, fetchLocal });
    return out;
  };
  const seen = [];
  const ok = await serve('https://blog1.ddev.site/about', async (u) => { seen.push(u.href); return page('<html><title>About</title><body><main><h1>About us</h1><script>steal()</script><form action="/user/login"><input name="pass"></form><a href="/contact">Contact</a></main></body></html>'); });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(seen, ['https://blog1.ddev.site/about']);
  assert.match(ok.html, /<h1>About us<\/h1>/);
  assert.ok(!/steal\(\)|<form|<input/.test(ok.html), 'no script and no form: a local page is read, never acted on');
  assert.match(ok.html, /a local site of this workspace \(dev\/blog1\), read without signing in/);
  assert.match(ok.html, /data-local-site="dev\/blog1"/);
  assert.match(ok.html, /href="\/fragments\/reader\?u=https%3A%2F%2Fblog1\.ddev\.site%2Fcontact"/, 'its links stay in the reader');
  assert.match(ok.csp, /default-src 'none'/);
  // A local site that sends the reader to a private address is not followed there.
  const away = await serve('https://blog1.ddev.site/go', async () => ({ status: 302, ok: false, headers: { get: (n) => (n.toLowerCase() === 'location' ? 'https://172.18.0.9/admin' : null) }, text: async () => '' }));
  assert.strictEqual(away.status, 403);
  assert.match(away.html, /only website names, not addresses/);
  // A page of the web is still asked of the web, never of the router.
  let web = 0;
  const pub = await serve('https://example.com/', async () => { throw new Error('the router was asked'); }, async () => { web += 1; return page('<html><title>Example</title><body><p>Hi</p></body></html>'); });
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(web, 1);
  assert.ok(!/local site/.test(pub.html));
});

test('a plugin is offered the lookup, and the docs say so', () => {
  const loader = fs.readFileSync(path.join(__dirname, '../../plugin-loader.js'), 'utf8');
  assert.match(loader, /localSite: \(urlOrHost\) => require\('\.\/local-sites'\)\.localSite\(urlOrHost\),/);
  assert.match(loader, /readerAllowed: \(url\) =>/);
  const doc = fs.readFileSync(path.join(__dirname, '../../PLUGINS.md'), 'utf8');
  assert.ok(doc.includes('`api.lib.localSite(urlOrHost)`') && doc.includes('`api.lib.readerAllowed(url)`'));
});
