/**
 * The local sites of this workspace: which project a host name belongs to, and how a page of one is read.
 *
 * The reading window opens public https pages only, because the fetch happens inside the dashboard's
 * container, which can reach the Docker network. A site the person built here is theirs, though: a
 * project folder of one of the workspace's folders that has a DDEV configuration, at the host names that
 * configuration gives it (`<name>.<project_tld>`, its additional host names). Only those names, only a
 * GET, with no cookie and no sign-in: a page of a local site is read, never acted on.
 *
 * Inside the dashboard's container a project's host name does not lead to it (it is 127.0.0.1 there), so
 * the page is asked of DDEV's router, by the project's name. The router's certificate is the machine's
 * own, which the container has no reason to trust: it is not checked, for these names only.
 */

const dns = require('dns').promises;
const fs = require('fs');
const https = require('https');
const path = require('path');
const { ddevHostnames } = require('./ddev-domains');

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_BYTES = 1500000;
const CACHE_MS = 20000;

/** The host names a DDEV project answers to, or [] for a folder that is not one. */
function projectHosts(dir) {
  let cfg;
  try { cfg = fs.readFileSync(path.join(dir, '.ddev', 'config.yaml'), 'utf8'); } catch (_) { return []; }
  const named = (cfg.match(/^name:\s*["']?([A-Za-z0-9][A-Za-z0-9-]*)["']?\s*$/m) || [])[1] || path.basename(dir);
  const { list, fqdns, tld } = ddevHostnames(dir);
  return [`${named}.${tld}`, ...list.map((label) => `${label}.${tld}`), ...fqdns]
    .map((h) => String(h).toLowerCase()).filter((h, i, all) => HOST_RE.test(h) && all.indexOf(h) === i);
}

let memo = { at: 0, sites: new Map() };
/** Every local site of the workspace, by host name: `{ workspace, project, dir, host }`. Looked up at most every twenty seconds. */
function localSites({ now = Date.now(), workspaces = null } = {}) {
  if (!workspaces && now - memo.at < CACHE_MS) return memo.sites;
  const ws = workspaces || (() => {
    const { loadWorkspaces, workspaceDir } = require('./workspaces');
    return Object.keys(loadWorkspaces()).map((key) => ({ key, dir: workspaceDir(key) }));
  })();
  const sites = new Map();
  for (const w of ws) {
    let names = [];
    try { names = fs.readdirSync(w.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name); } catch (_) { continue; }
    for (const project of names) {
      const dir = path.join(w.dir, project);
      for (const host of projectHosts(dir)) if (!sites.has(host)) sites.set(host, { workspace: w.key, project, dir, host });
    }
  }
  if (!workspaces) memo = { at: now, sites };
  return sites;
}

/** The local site a URL or a host name belongs to, or null: `{ workspace, project, dir, host }`. */
function localSite(urlOrHost, opts) {
  let host = String(urlOrHost || '').toLowerCase();
  try { if (/^[a-z]+:\/\//.test(host)) host = new URL(host).hostname.toLowerCase(); } catch (_) { return null; }
  return HOST_RE.test(host) ? (localSites(opts).get(host) || null) : null;
}

let router = null;
/** Where DDEV's router is, from here: by its name inside the container, on this machine otherwise. */
async function routerHost(lookup = dns.lookup) {
  if (process.env.WORKSPACE_DDEV_ROUTER) return process.env.WORKSPACE_DDEV_ROUTER;
  if (router === null) {
    try { await lookup('ddev-router'); router = 'ddev-router'; } catch (_) { router = '127.0.0.1'; }
  }
  return router;
}

/** GET a page of a local site through the router: `{ status, ok, headers: { get }, text() }`, as much of fetch as the reader uses. */
async function fetchLocalSite(u, { request = https.request, lookup = dns.lookup } = {}) {
  const host = await routerHost(lookup);
  return new Promise((resolve, reject) => {
    const req = request({
      host, port: 443, method: 'GET', path: `${u.pathname}${u.search}`, servername: u.hostname, rejectUnauthorized: false, timeout: 12000,
      headers: { Host: u.hostname, 'User-Agent': 'Mozilla/5.0 (compatible; Webship Workspace reader)', Accept: 'text/html,text/plain;q=0.9' },
    }, (res) => {
      const parts = []; let size = 0;
      res.on('data', (d) => { size += d.length; if (size <= MAX_BYTES) parts.push(d); else res.destroy(); });
      const done = () => resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: { get: (name) => { const v = res.headers[String(name).toLowerCase()]; return Array.isArray(v) ? v[0] : (v || null); } },
        text: async () => Buffer.concat(parts).toString('utf8'),
      });
      res.on('end', done);
      res.on('close', done);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { projectHosts, localSites, localSite, routerHost, fetchLocalSite };
