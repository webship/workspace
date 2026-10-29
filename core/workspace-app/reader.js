/**
 * The avatar's browser window: a web page, read through this server.
 *
 * Most pages a team needs (drupal.org, GitHub, MDN) refuse to be shown inside another page, so the
 * window cannot simply frame them. GET /fragments/reader?u=<https url> fetches the page here and
 * serves its main content back, cleaned: no scripts, frames, forms, styles from elsewhere or event
 * handlers, every link pointing back into the reader, and a Content-Security-Policy that allows none
 * of it to run anyway.
 *
 * The fetch happens inside the dashboard's container, which can reach the Docker network and every
 * DDEV project, so an address is only fetched when it is https, a name rather than an IP, and every
 * address it resolves to is public; each redirect is checked the same way. A page that answers a
 * program with a bot check (drupal.org does) is said so plainly, with the link to open in a tab:
 * the reader never tries to get past one.
 */

const dns = require('dns').promises;
const net = require('net');
const { esc } = require('./html');

const MAX_BYTES = 1500000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

/** Whether a URL may be fetched: https, a public name, every address it resolves to public. */
async function allowed(u, lookup = dns.lookup) {
  if (u.protocol !== 'https:') return 'only https pages can be opened';
  if (u.port && u.port !== '443') return 'only the standard https port';
  const host = u.hostname.toLowerCase();
  if (net.isIP(host) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return 'only website names, not addresses';
  if (/(^|\.)(ddev\.site|localhost|local|internal|lan)$/.test(host)) return 'local sites open in their own tab';
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return 'that address is not a public website';
  } catch (_) { return 'that site could not be found'; }
  return '';
}

const isChallenge = (html) => /<title[^>]*>\s*(Client Challenge|Just a moment|Attention Required|Verifying you are human)/i
  .test(String(html || '').slice(0, 20000));

const readerLink = (abs) => `/fragments/reader?u=${encodeURIComponent(abs)}`;

/** The page's main content, cleaned, with its links pointing back into the reader. */
function cleanHtml(html, base) {
  let b = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || [])[1];
  if (!b) {
    b = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
    b = b.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi, '');
  }
  b = b.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|object|template|svg|math|canvas|video|audio|dialog)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|noscript|iframe|object|embed|form|input|button|select|textarea|label|link|meta|base|template|source|track|frame|frameset)\b[^>]*>/gi, '')
    .replace(/\s(on\w+|style|srcset|sizes|formaction|ping|xmlns(?::\w+)?)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  b = b.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (m, q, h1, h2) => {
    const href = (h1 ?? h2 ?? '').replace(/&amp;/g, '&');
    if (href.startsWith('#')) return `<a href="${esc(href)}">`;
    let abs;
    try { abs = new URL(href, base); } catch (_) { return '<a>'; }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') return '<a>';
    abs.protocol = 'https:';
    return `<a href="${esc(readerLink(abs.href))}" title="${esc(abs.href)}">`;
  });
  b = b.replace(/<img\b([^>]*?)src\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi, (m, pre, q, s1, s2, post) => {
    let abs;
    try { abs = new URL((s1 ?? s2 ?? '').replace(/&amp;/g, '&'), base); } catch (_) { return ''; }
    if (abs.protocol !== 'https:') return '';
    const alt = (`${pre} ${post}`.match(/\salt\s*=\s*"([^"]*)"/i) || [])[1] || '';
    return `<img src="${esc(abs.href)}" alt="${esc(alt)}" loading="lazy">`;
  });
  return b;
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
body { margin: 0; padding: .9rem 1.1rem 2.5rem; font: 15px/1.65 system-ui, sans-serif; color: #1d1d1f; background: #fff; }
h1, h2, h3 { color: #2b447c; line-height: 1.3; } h1 { font-size: 1.35rem; }
a { color: #0063c0; text-decoration: none; } a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; } table { border-collapse: collapse; display: block; overflow-x: auto; font-size: .9rem; }
td, th { border: 1px solid #ddd; padding: .25rem .4rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f6f8; padding: .6rem .8rem; border-radius: .4rem; font-size: .85rem; }
code { background: #f5f6f8; padding: 0 .2rem; border-radius: .2rem; } pre code { background: none; padding: 0; }
.hint { color: #666; font-size: .85rem; }
</style></head><body>${body}</body></html>`;
}

/** GET /fragments/reader?u=… */
async function serveReader(res, raw, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  const out = (status, html) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  };
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return out(400, page('Not a page', '<p class="hint">That is not a link.</p>')); }
  const refuse = (why, status = 403) => out(status, page(u.hostname, `<h1>${esc(u.hostname)}</h1><p class="hint">${esc(why)}.</p><p class="hint">${esc(u.href)}</p>`));
  try {
    for (let hop = 0; hop < 6; hop++) {
      const why = await allowed(u, lookup);
      if (why) return refuse(why);
      const r = await fetchImpl(u.href, { redirect: 'manual', signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Webship Workspace reader)', Accept: 'text/html,text/plain;q=0.9' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
      if (!r.ok) return refuse(`that page answered ${r.status}`, r.status === 404 ? 404 : 502);
      const type = String(r.headers.get('content-type') || '');
      const body = (await r.text()).slice(0, MAX_BYTES);
      const crumb = `<p class="hint">${esc(u.hostname)}${esc(u.pathname.length > 1 ? u.pathname.slice(0, 90) : '')}</p>`;
      if (/text\/plain/.test(type)) return out(200, page(u.pathname.split('/').pop() || u.hostname, `${crumb}<pre>${esc(body.slice(0, 200000))}</pre>`));
      if (!/text\/html|application\/xhtml/.test(type)) return refuse('that is not a page the reader can show', 415);
      if (isChallenge(body)) return refuse(`${u.hostname} only opens in a real browser tab`);
      const title = ((body.match(/<title[^>]*>([\s\S]{1,2000}?)<\/title>/i) || [])[1] || u.hostname).replace(/\s+/g, ' ').replace(/&amp;/g, '&').trim().slice(0, 140);
      return out(200, page(title, `${crumb}${cleanHtml(body, u.href)}`));
    }
    return refuse('too many redirects');
  } catch (_) { return refuse('that page could not be reached', 502); }
}

module.exports = { serveReader, allowed, privateIp, cleanHtml, isChallenge, readerLink };
