/**
 * Sign in with Google for the dashboard, off by default.
 *
 * On a laptop the dashboard answers only that laptop and has never asked who you are. On a remote hub
 * (hub_domain set to a public domain) it must: it starts builds, opens terminals and edits settings. When
 * `auth.google.enabled` is true, every request to the dashboard needs a session from this module, and a
 * session is only given to a Google account whose verified email is in `allowed_domains` (or in
 * `allowed_emails`). Nothing allowed means nobody is let in.
 *
 *   auth:
 *     google:
 *       enabled: true
 *       allowed_domains: [vardot.com]
 *       session_hours: 12
 *
 * The OAuth client is the Drive plugin's (client_id and client_secret in plugin.google-drive-sync.settings.yml),
 * so there is a single client to set up. Add
 * https://<hub_domain>/auth/google/callback to its redirect URIs.
 *
 * Fails closed: enabled with no OAuth client or no allow-list answers 503 with what to fix, rather than
 * letting everyone through. To switch it off by hand set `auth.google.enabled: false` in settings.yml;
 * settings are read live, so no restart is needed.
 *
 * The ID token comes straight from Google's token endpoint over TLS in exchange for our one-time code, so
 * its claims (issuer, audience, expiry, nonce, verified email, hosted domain) are checked but its
 * signature is not: the channel is the proof, which is what OpenID Connect allows for that flow.
 *
 * The session is a signed cookie on the hub domain, so one sign-in covers every <workspace>.<hub> page.
 * Project sites at <project>.<workspace>.<hub> are served by the DDEV router, not by this app, and are not
 * covered.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { loadSettings, hubDomain } = require('./workspaces');
const { esc } = require('./html');
const { readPluginSettings } = require('./plugin-settings');

const COOKIE = 'ws-session';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SECRET_FILE = () => path.join(process.env.WORKSPACE_AUTH_DIR || path.join(__dirname, '.auth'), 'session-secret');

const real = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s && !/^(CHANGE_ME|sk-change-this)$/i.test(s) ? s : '';
};
const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

function config() {
  const s = loadSettings();
  const g = (s.auth && s.auth.google) || {};
  const d = readPluginSettings('google-drive-sync');    // the team's one OAuth client lives with the Drive plugin
  const hours = Number(g.session_hours);
  return {
    enabled: g.enabled === true || String(g.enabled) === 'true',
    domains: list(g.allowed_domains),
    emails: list(g.allowed_emails),
    hours: hours > 0 && hours <= 24 * 30 ? hours : 12,
    clientId: real(d.client_id),
    clientSecret: real(d.client_secret),
    redirectUri: `https://${hubDomain()}/auth/google/callback`,
  };
}

// ---- Session cookie ---------------------------------------------------------------------------

function secret() {
  const file = SECRET_FILE();
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { /* first use */ }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const made = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, made, { mode: 0o600, flag: 'wx' }); } catch (_) { return fs.readFileSync(file, 'utf8').trim(); }
  return made;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function makeSession(user, hours) {
  const body = b64({ e: user.email, n: user.name || '', x: Date.now() + hours * 3600 * 1000 });
  return `${body}.${sign(body)}`;
}

/** The signed-in user of a request, or null. A tampered or expired cookie is nobody. */
function sessionOf(req) {
  const raw = String((req.headers && req.headers.cookie) || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.x > Date.now() && p.e ? { email: p.e, name: p.n || '' } : null;
  } catch (_) { return null; }
}

const cookieHeader = (value, maxAge) => `${COOKIE}=${value}; Path=/; Domain=.${hubDomain()}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---- Who may sign in --------------------------------------------------------------------------

/** { ok, reason } for the claims of a Google ID token. */
function allowed(claims, cfg) {
  const email = String(claims.email || '').toLowerCase();
  if (!email || claims.email_verified !== true) return { ok: false, reason: 'Google has not verified that email address.' };
  if (!cfg.domains.length && !cfg.emails.length) return { ok: false, reason: 'No allowed domain or email is set, so nobody may sign in.' };
  if (cfg.emails.includes(email)) return { ok: true };
  const domain = email.split('@')[1];
  if (cfg.domains.includes(domain) && String(claims.hd || '').toLowerCase() === domain) return { ok: true };
  return { ok: false, reason: `${email} is not allowed to use this dashboard.` };
}

function idClaims(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')); } catch (_) { return null; }
}

// ---- Sign-in flow -----------------------------------------------------------------------------

const pending = new Map();   // state -> { nonce, next, until }

// Where to send somebody afterwards. Only the hub or one of its workspace pages: anything else would make
// the sign-in a way to bounce a user to a site of somebody's choosing.
function safeNext(next) {
  try {
    const u = new URL(String(next || ''), `https://${hubDomain()}`);
    const hub = hubDomain();
    if (u.protocol === 'https:' && (u.hostname === hub || u.hostname.endsWith(`.${hub}`)) && !u.pathname.startsWith('//')) return u.toString();
  } catch (_) { /* fall through */ }
  return `https://${hubDomain()}/`;
}

function startUrl(cfg, next) {
  for (const [k, v] of pending) if (v.until < Date.now()) pending.delete(k);
  const state = crypto.randomBytes(18).toString('hex');
  const nonce = crypto.randomBytes(18).toString('hex');
  pending.set(state, { nonce, next: safeNext(next), until: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid email profile',
    state, nonce, prompt: 'select_account',
  });
  if (cfg.domains.length === 1) q.set('hd', cfg.domains[0]);       // a hint for the account chooser, not the check
  return `${AUTH_URL}?${q}`;
}

async function finish(cfg, code, state) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.until < Date.now()) return { ok: false, reason: 'That sign-in link expired. Start again.' };
  const res = await fetch(tokenUrl(), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: `Google refused the sign-in: ${body.error_description || body.error || res.status}` };
  const c = idClaims(body.id_token);
  if (!c || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.aud !== cfg.clientId || !(c.exp * 1000 > Date.now()) || c.nonce !== p.nonce) {
    return { ok: false, reason: 'Google returned a sign-in that does not match this request.' };
  }
  const verdict = allowed(c, cfg);
  if (!verdict.ok) return verdict;
  return { ok: true, user: { email: String(c.email).toLowerCase(), name: c.name || '' }, next: p.next };
}

// ---- Pages ------------------------------------------------------------------------------------

const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

/** The standard white Google button. Used by the sign-in page and the Drive panel. */
const googleButton = (href, label = 'Sign in with Google', attrs = '') => `<a class="google-btn" href="${esc(href)}" ${attrs}>${GOOGLE_G}<span>${esc(label)}</span></a>`;

const BUTTON_CSS = '.google-btn{display:inline-flex;align-items:center;gap:.6rem;padding:.55rem 1rem;border:1px solid #dadce0;border-radius:4px;background:#fff;color:#3c4043;font:500 .9rem/1 system-ui,sans-serif;text-decoration:none}.google-btn:hover{background:#f8f9fa;box-shadow:0 1px 2px rgba(60,64,67,.3)}';

function page(title, body, status = 200) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.4rem}.meta{color:#666;font-size:.85rem}${BUTTON_CSS}@media(prefers-color-scheme:dark){body{background:#12151f;color:#e8e8e8}.meta{color:#999}}</style>
<body>${body}</body>`;
  return { status, html };
}

const signinPage = (cfg, next) => page('Sign in', `<h1>Webship Workspace</h1><p>Sign in with your ${cfg.domains.length ? esc(cfg.domains.join(' or ')) : ''} Google account to continue.</p>
  <p>${googleButton(`/auth/google/login?next=${encodeURIComponent(next || '')}`)}</p>`);

const deniedPage = (reason) => page('Not allowed', `<h1>Not signed in</h1><p>${esc(reason)}</p><p><a href="/auth/signin">Try another account</a></p>
  <p class="meta">Locked yourself out? Set <code>auth.google.enabled: false</code> in core/config/settings.yml. It takes effect at once.</p>`, 403);

const unavailablePage = () => page('Sign-in is not set up', `<h1>Sign-in is on, but not set up</h1><p>The dashboard needs Google sign-in and has no OAuth client or no allowed domain to check against, so it is letting nobody in.</p>
  <p class="meta">Set <code>google_drive.client_id</code>, <code>client_secret</code> and <code>auth.google.allowed_domains</code> in core/config/settings.yml, or turn it off with <code>auth.google.enabled: false</code>. Settings are read live.</p>`, 503);

// ---- The gate ---------------------------------------------------------------------------------

const EXEMPT = /^\/auth\/(signin|signout|me|google\/(login|callback))$/;

function send(res, p, extra = {}) {
  res.writeHead(p.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(p.html);
}

const hostUrl = (req) => `https://${req.headers.host || hubDomain()}${req.url}`;

/**
 * Called first for every request. Returns true when it has answered (sign-in routes, or a refusal);
 * false means the request may carry on to the dashboard. With sign-in off it is always false.
 */
async function gate(req, res, pathname) {
  const cfg = config();
  if (!cfg.enabled) {
    if (pathname === '/auth/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"enabled":false}'); return true; }
    return false;
  }
  const url = new URL(req.url, 'http://x');
  const usable = cfg.clientId && cfg.clientSecret && (cfg.domains.length || cfg.emails.length);

  if (EXEMPT.test(pathname)) {
    if (pathname === '/auth/me') {
      const u = sessionOf(req);
      res.writeHead(u ? 200 : 401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(u ? { enabled: true, ...u } : { enabled: true }));
      return true;
    }
    if (!usable) { send(res, unavailablePage()); return true; }
    if (pathname === '/auth/signin') { send(res, signinPage(cfg, url.searchParams.get('next'))); return true; }
    if (pathname === '/auth/signout') { res.writeHead(302, { Location: '/auth/signin', 'Set-Cookie': cookieHeader('', 0) }); res.end(); return true; }
    if (pathname === '/auth/google/login') { res.writeHead(302, { Location: startUrl(cfg, url.searchParams.get('next')) }); res.end(); return true; }
    if (pathname === '/auth/google/callback') {
      if (url.searchParams.get('error')) { send(res, deniedPage(`Google said: ${url.searchParams.get('error')}`)); return true; }
      try {
        const r = await finish(cfg, String(url.searchParams.get('code') || ''), String(url.searchParams.get('state') || ''));
        if (!r.ok) { send(res, deniedPage(r.reason)); return true; }
        res.writeHead(302, { Location: r.next, 'Set-Cookie': cookieHeader(makeSession(r.user, cfg.hours), cfg.hours * 3600), 'Cache-Control': 'no-store' });
        res.end();
      } catch (err) { send(res, deniedPage(`Could not sign in: ${err.message}`)); }
      return true;
    }
  }

  if (!usable) { send(res, unavailablePage()); return true; }
  if (sessionOf(req)) return false;

  // Not signed in. A page navigation goes to the sign-in page; a fragment or action says 401, and htmx is
  // told where to go, so a session that expired mid-use sends the person to sign in instead of showing a blank.
  const login = `https://${hubDomain()}/auth/signin?next=${encodeURIComponent(hostUrl(req))}`;
  if (req.headers['hx-request']) { res.writeHead(401, { 'HX-Redirect': login, 'Content-Type': 'text/plain' }); res.end('Sign in required'); return true; }
  if (req.method === 'GET' || req.method === 'HEAD') { res.writeHead(302, { Location: login, 'Cache-Control': 'no-store' }); res.end(); return true; }
  res.writeHead(401, { 'Content-Type': 'text/plain' });
  res.end('Sign in required');
  return true;
}

/** For a WebSocket upgrade, which cannot be redirected: may this request through? */
function upgradeAllowed(req) {
  const cfg = config();
  if (!cfg.enabled) return true;
  return !!(cfg.clientId && cfg.clientSecret && (cfg.domains.length || cfg.emails.length) && sessionOf(req));
}

module.exports = { gate, upgradeAllowed, sessionOf, makeSession, allowed, safeNext, config, googleButton, BUTTON_CSS, COOKIE };
