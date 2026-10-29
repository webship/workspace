/**
 * Sign in with Google for the dashboard: who gets in, what the cookie proves, and what a request meets
 * when it has none. Google is a local stand-in; the module's own handler is wrapped in a bare http server,
 * so what is tested is the gate, not the rest of the dashboard.
 */

const assert = require('node:assert');
const { test } = require('node:test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-auth-'));
process.env.WORKSPACE_CONFIG = CONFIG;
process.env.WORKSPACE_AUTH_DIR = path.join(CONFIG, '.auth');
const HUB = 'hub.example.test';

const setSettings = (extra = '') => fs.writeFileSync(path.join(CONFIG, 'settings.yml'), [
  `hub_domain: ${HUB}`, 'google_drive:', '  client_id: cid.apps.googleusercontent.com', '  client_secret: csecret1234', extra,
].join('\n'));
const signinOn = (more = '') => setSettings(`auth:\n  google:\n    enabled: true\n    allowed_domains:\n      - vardot.com\n${more}`);

const auth = require('../../auth-google');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `h.${b64(claims)}.s`;

function appServer() {
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (await auth.gate(req, res, pathname)) return;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('the dashboard');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const get = (server, p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: { host: `dev.${HUB}`, ...headers } }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});

test('with sign-in off the dashboard is open, as it always was', async () => {
  setSettings();
  const s = await appServer();
  try {
    assert.strictEqual((await get(s, '/')).body, 'the dashboard');
    assert.deepStrictEqual(JSON.parse((await get(s, '/auth/me')).body), { enabled: false });
  } finally { s.close(); }
});

test('with sign-in on, a page goes to sign in, an htmx call is told to, and an action gets 401', async () => {
  signinOn();
  const s = await appServer();
  try {
    const page = await get(s, '/dev');
    assert.strictEqual(page.status, 302);
    assert.match(page.headers.location, new RegExp(`^https://${HUB}/auth/signin\\?next=`));
    assert.match(decodeURIComponent(page.headers.location), new RegExp(`next=https://dev\\.${HUB}/dev$`));
    const htmx = await get(s, '/fragments/anything', { 'hx-request': 'true' });
    assert.strictEqual(htmx.status, 401);
    assert.match(htmx.headers['hx-redirect'], /\/auth\/signin/);
    const post = await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: s.address().port, path: '/actions/build', method: 'POST', headers: { host: `dev.${HUB}` } }, (res) => { res.resume(); resolve(res.statusCode); }); r.end(); });
    assert.strictEqual(post, 401);
  } finally { s.close(); }
});

test('it fails closed: on with no client, or with nobody allowed, it lets nobody in and says why', async () => {
  fs.writeFileSync(path.join(CONFIG, 'settings.yml'), `hub_domain: ${HUB}\nauth:\n  google:\n    enabled: true\n    allowed_domains:\n      - vardot.com\n`);
  let s = await appServer();
  try {
    const r = await get(s, '/dev');
    assert.strictEqual(r.status, 503);
    assert.match(r.body, /letting nobody in/);
  } finally { s.close(); }
  setSettings('auth:\n  google:\n    enabled: true');
  s = await appServer();
  try { assert.strictEqual((await get(s, '/dev')).status, 503); } finally { s.close(); }
});

test('the cookie proves who you are, and a forged, edited or expired one proves nothing', () => {
  signinOn();
  const good = auth.makeSession({ email: 'a@vardot.com', name: 'A' }, 1);
  const req = (c) => ({ headers: { cookie: `x=1; ws-session=${c}` } });
  assert.deepStrictEqual(auth.sessionOf(req(good)), { email: 'a@vardot.com', name: 'A' });
  const [body, mac] = good.split('.');
  const edited = `${b64({ ...JSON.parse(Buffer.from(body, 'base64url')), e: 'boss@vardot.com' })}.${mac}`;
  assert.strictEqual(auth.sessionOf(req(edited)), null, 'editing the email breaks the signature');
  assert.strictEqual(auth.sessionOf(req(`${body}.${'A'.repeat(mac.length)}`)), null);
  assert.strictEqual(auth.sessionOf(req(auth.makeSession({ email: 'a@vardot.com' }, -1))), null, 'expired');
  assert.strictEqual(auth.sessionOf({ headers: {} }), null);
});

test('who is allowed: a verified address on an allowed Workspace domain, or one named address', () => {
  const cfg = { domains: ['vardot.com'], emails: ['guest@example.org'] };
  const ok = (c) => auth.allowed(c, cfg).ok;
  assert.ok(ok({ email: 'a@vardot.com', email_verified: true, hd: 'vardot.com' }));
  assert.ok(ok({ email: 'A@Vardot.com', email_verified: true, hd: 'vardot.com' }), 'case does not matter');
  assert.ok(!ok({ email: 'a@vardot.com', email_verified: false, hd: 'vardot.com' }), 'unverified');
  assert.ok(!ok({ email: 'a@vardot.com', email_verified: true }), 'a plain gmail-style account cannot claim the domain: no hd');
  assert.ok(!ok({ email: 'a@evil.com', email_verified: true, hd: 'evil.com' }));
  assert.ok(!ok({ email: 'a@vardot.com.evil.com', email_verified: true, hd: 'vardot.com.evil.com' }), 'a suffix is not the domain');
  assert.ok(ok({ email: 'guest@example.org', email_verified: true }), 'a named address needs no domain');
  assert.ok(!auth.allowed({ email: 'a@vardot.com', email_verified: true, hd: 'vardot.com' }, { domains: [], emails: [] }).ok, 'nothing allowed, nobody in');
});

test('a full sign-in, against a stand-in for Google, ends in a cookie that opens the dashboard', async () => {
  signinOn();
  let seen;
  const google = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => { seen = new URLSearchParams(b); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id_token: idToken(google.claims) })); });
  });
  await new Promise((r) => google.listen(0, '127.0.0.1', r));
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${google.address().port}/token`;
  const s = await appServer();
  try {
    const start = await get(s, `/auth/google/login?next=${encodeURIComponent(`https://dev.${HUB}/dev`)}`);
    assert.strictEqual(start.status, 302);
    const to = new URL(start.headers.location);
    assert.strictEqual(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.strictEqual(to.searchParams.get('scope'), 'openid email profile');
    assert.strictEqual(to.searchParams.get('redirect_uri'), `https://${HUB}/auth/google/callback`);
    assert.strictEqual(to.searchParams.get('hd'), 'vardot.com');
    const state = to.searchParams.get('state');
    const claims = { iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com', exp: Math.floor(Date.now() / 1000) + 600, nonce: to.searchParams.get('nonce'), email: 'member@vardot.com', email_verified: true, hd: 'vardot.com', name: 'Team Member' };

    google.claims = { ...claims, nonce: 'someone-elses' };
    const replayed = await get(s, `/auth/google/callback?code=c&state=${state}`);
    assert.strictEqual(replayed.status, 403, 'a token for a different request is refused');
    assert.match(replayed.body, /does not match/);

    const again = await get(s, `/auth/google/login?next=${encodeURIComponent(`https://dev.${HUB}/dev`)}`);
    const t2 = new URL(again.headers.location);
    google.claims = { ...claims, nonce: t2.searchParams.get('nonce') };
    const done = await get(s, `/auth/google/callback?code=thecode&state=${t2.searchParams.get('state')}`);
    assert.strictEqual(done.status, 302, done.body);
    assert.strictEqual(done.headers.location, `https://dev.${HUB}/dev`);
    assert.strictEqual(seen.get('code'), 'thecode');
    const cookie = done.headers['set-cookie'][0];
    assert.match(cookie, new RegExp(`Domain=\\.${HUB.replace(/\./g, '\\.')}; HttpOnly; Secure; SameSite=Lax`));
    const inside = await get(s, '/dev', { cookie: cookie.split(';')[0] });
    assert.strictEqual(inside.body, 'the dashboard');
    assert.deepStrictEqual(JSON.parse((await get(s, '/auth/me', { cookie: cookie.split(';')[0] })).body), { enabled: true, email: 'member@vardot.com', name: 'Team Member' });

    const out = await get(s, '/auth/signout', { cookie: cookie.split(';')[0] });
    assert.match(out.headers['set-cookie'][0], /Max-Age=0/);

    const third = await get(s, '/auth/google/login');
    const t3 = new URL(third.headers.location);
    google.claims = { ...claims, nonce: t3.searchParams.get('nonce'), email: 'x@gmail.com', hd: undefined };
    const denied = await get(s, `/auth/google/callback?code=c&state=${t3.searchParams.get('state')}`);
    assert.strictEqual(denied.status, 403);
    assert.ok(!denied.headers['set-cookie'], 'no cookie for a refused account');
    assert.match(denied.body, /not allowed/);
  } finally { s.close(); google.close(); delete process.env.GOOGLE_TOKEN_URL; }
});

test('after sign-in only the hub or a workspace page is a place to go back to', () => {
  signinOn();
  assert.strictEqual(auth.safeNext(`https://dev.${HUB}/dev`), `https://dev.${HUB}/dev`);
  assert.strictEqual(auth.safeNext('https://evil.example/'), `https://${HUB}/`);
  assert.strictEqual(auth.safeNext(`https://${HUB}.evil.example/`), `https://${HUB}/`);
  assert.strictEqual(auth.safeNext(`http://dev.${HUB}/`), `https://${HUB}/`, 'not downgraded to http');
  assert.strictEqual(auth.safeNext('//evil.example/x'), `https://${HUB}/`);
  assert.strictEqual(auth.safeNext('/settings'), `https://${HUB}/settings`);
});

test('a terminal socket needs the session too', () => {
  signinOn();
  assert.strictEqual(auth.upgradeAllowed({ headers: {} }), false);
  assert.strictEqual(auth.upgradeAllowed({ headers: { cookie: `ws-session=${auth.makeSession({ email: 'a@vardot.com' }, 1)}` } }), true);
  setSettings();
  assert.strictEqual(auth.upgradeAllowed({ headers: {} }), true, 'and open when sign-in is off');
});
