/**
 * Who can reach this dashboard: the address it listens on, and the host names it answers to.
 *
 * The dashboard has no login of its own (until Sign in with Google is turned on) and it runs commands,
 * so what keeps it safe is that nobody else can reach it (README, "Security posture"). Two ways round
 * that are closed here.
 *
 * - The address. Started with node on a machine (`node server.js`: CI, a round of tests, a person who
 *   does not use DDEV), it listened on every interface, and anyone on the same network could post an
 *   action or open a terminal. It listens on 127.0.0.1 now, unless WORKSPACE_LISTEN names another
 *   address. In a container (DDEV's web container, IS_DDEV_PROJECT) it still listens on every interface
 *   of the container: the router in front of it decides what reaches it, and binds 127.0.0.1 by default.
 *
 * - The name. A page on another site whose name is made to resolve to 127.0.0.1 (DNS rebinding) sends
 *   that name as Host, and as Origin, so the same-origin check passed and the page drove the dashboard.
 *   A request is answered only under a name the dashboard is known by: localhost, an IP address (it
 *   cannot be rebound), *.ddev.site, the hub domain and its subdomains, and the names in
 *   WORKSPACE_ALLOWED_HOSTS (comma separated; `.example.org` takes its subdomains too).
 */

const fs = require('fs');
const net = require('net');

/** Inside a container: DDEV's web container, any Docker or Podman one, or a pod of a Kubernetes cluster. */
function inContainer({ env = process.env, exists = fs.existsSync } = {}) {
  return env.IS_DDEV_PROJECT === 'true' || exists('/.dockerenv') || exists('/run/.containerenv') || !!env.KUBERNETES_SERVICE_HOST;
}

/** The address to listen on: WORKSPACE_LISTEN when it is set, every interface in a container (undefined), else 127.0.0.1. */
function listenHost({ env = process.env, exists = fs.existsSync } = {}) {
  const asked = String(env.WORKSPACE_LISTEN || '').trim();
  if (asked) return asked;
  return inContainer({ env, exists }) ? undefined : '127.0.0.1';
}

/** Is this a loopback address (or the name of one)? */
function isLoopback(address) {
  const a = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return a === 'localhost' || a === '::1' || /^127\./.test(a);
}

/** The names WORKSPACE_ALLOWED_HOSTS adds, lower case. `*.example.org` is read as `.example.org`. */
function extraHosts(env = process.env) {
  return String(env.WORKSPACE_ALLOWED_HOSTS || '').split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase().replace(/^\*\./, '.').replace(/\.$/, ''))
    .filter(Boolean);
}

/** The name in a Host header: lower case, without its port or a trailing dot, an IPv6 address without brackets. */
function hostName(header) {
  const h = String(header || '').trim().toLowerCase();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h;
  }
  // name:port has one colon; an IPv6 address written without brackets has several and no port.
  const named = h.indexOf(':') === h.lastIndexOf(':') ? h.replace(/:\d*$/, '') : h;
  return named.replace(/\.$/, '');
}

/** May a request with this Host header be answered? A request with no Host at all is a local tool, not a browser. */
function hostAllowed(header, { hub = '', extra = [] } = {}) {
  const h = hostName(header);
  if (!h) return true;
  if (net.isIP(h)) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'ddev.site' || h.endsWith('.ddev.site')) return true;
  const own = String(hub || '').trim().toLowerCase().replace(/\.$/, '');
  if (own && (h === own || h.endsWith(`.${own}`))) return true;
  return extra.some((e) => (e.startsWith('.') ? h === e.slice(1) || h.endsWith(e) : h === e));
}

/** What a refused request is told: plain text, because it is not a page of this dashboard. */
function refusalText(header) {
  const h = hostName(header) || String(header || '');
  return `This dashboard does not answer to the name ${h.slice(0, 100)}. It answers to localhost, `
    + 'an IP address, *.ddev.site and its hub domain: a page that reached it under any other name is '
    + 'refused, because that is how another site would drive it (DNS rebinding). To open it under '
    + `another name, add the name to WORKSPACE_ALLOWED_HOSTS where the dashboard is started.\n`;
}

// Where the server is listening, once it is: what the exposure banner reads (workspaces.js exposureRisk).
let bound = null;
function setBound(address) { bound = address || null; }

/** Why this dashboard can be reached from other machines, or '' when it cannot. */
function bindExposure({ env = process.env, exists = fs.existsSync, address = bound } = {}) {
  if (inContainer({ env, exists })) return '';
  const a = String(address || '');
  if (!a || isLoopback(a)) return '';
  return `the dashboard listens on ${a === '::' || a === '0.0.0.0' ? 'every interface of this machine' : a} (WORKSPACE_LISTEN), not only on 127.0.0.1`;
}

module.exports = { inContainer, listenHost, isLoopback, extraHosts, hostName, hostAllowed, refusalText, setBound, bindExposure };
