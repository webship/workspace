/**
 * The hub's URLs, in one place.
 *
 * Locally the hub is workspace.ddev.site; `hub_domain` in settings.yml points the whole scheme at a
 * public domain instead, which is what lets this run as a remote development hub.
 */

const { hubDomain } = require('./workspaces');

const HOME_URL = () => `https://${hubDomain()}`;
const wsUrl = (key, sub = '') => `https://${key}.${hubDomain()}${sub}`;

module.exports = { HOME_URL, wsUrl };
