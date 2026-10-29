/**
 * The hub's URLs, in one place.
 *
 * Locally the hub is workspace.ddev.site; `hub_domain` in settings.yml points the whole scheme at a
 * public domain instead, which is what lets this run as a remote development hub.
 */

const { hubDomain } = require('./workspaces');

const HOME_URL = () => `https://${hubDomain()}`;
const wsUrl = (key, sub = '') => `https://${key}.${hubDomain()}${sub}`;

// The Web IDE (code-server) lives on its own hostname under the hub domain, so it follows
// hub_domain like every other URL here rather than being written down twice. Its own
// hostname and not a subpath: code-server builds absolute URLs for its workers, its
// websocket and its assets, and upstream's guidance is a dedicated (sub)domain.
const IDE_HOST = () => `ide.${hubDomain()}`;
const ideBaseUrl = () => `https://${IDE_HOST()}`;
// Where the IDE actually listens, inside this container. Loopback on purpose: the ide.*
// vhost is the only way in.
const IDE_BIND = { host: '127.0.0.1', port: 8443 };

module.exports = { HOME_URL, wsUrl, ideBaseUrl, IDE_HOST, IDE_BIND };
