/**
 * The hub's URLs, in one place.
 *
 * Locally the hub is workspace.ddev.site; `hub_domain` in settings.yml points the whole scheme at a
 * public domain instead, which is what lets this run as a remote development hub.
 *
 * A link leads to the dashboard it was drawn on. On the hub and its workspace subdomains the scheme is
 * absolute — a workspace is its own subdomain, dev.workspace.ddev.site — and that is unchanged. A
 * dashboard asked on any other address (node on a port, an IP, a tunnel) serves the same pages as paths,
 * so there the links are paths too: the logo, the workspace cards and "Backups for this workspace" used to
 * send a click on localhost:3996 to workspace.ddev.site, another dashboard. Each request is answered
 * inside its own context (withRequest, around the server's handler) so these know the address it came in
 * on; outside a request (the command line) they stay absolute.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { hubDomain } = require('./workspaces');

const requests = new AsyncLocalStorage();

/** Run fn as the answer to req: HOME_URL() and wsUrl() inside it know the address it was asked on. */
const withRequest = (req, fn) => requests.run({ host: String((req && req.headers && req.headers.host) || '') }, fn);

/** Is this Host header the hub or one of its workspace subdomains (with or without a port)? */
function onHub(host) {
  const name = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const hub = String(hubDomain()).toLowerCase();
  return name === hub || name.endsWith(`.${hub}`);
}

/** Absolute hub URLs, or paths on the address the page was asked on. */
function absolute() {
  const store = requests.getStore();
  return !store || !store.host || onHub(store.host);
}

const HOME_URL = () => (absolute() ? `https://${hubDomain()}` : '/');
const wsUrl = (key, sub = '') => (absolute() ? `https://${key}.${hubDomain()}${sub}` : `/${key}${sub}`);

module.exports = { HOME_URL, wsUrl, withRequest, onHub };
