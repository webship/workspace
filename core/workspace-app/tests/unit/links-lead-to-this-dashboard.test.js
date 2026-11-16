/**
 * The logo and the workspace links lead to the dashboard they were drawn on.
 *
 * HOME_URL() and wsUrl() were always https://workspace.ddev.site and https://<folder>.workspace.ddev.site, so a
 * dashboard on localhost:3996 sent a click on its own logo or a workspace card to another dashboard. On the
 * hub (and its workspace subdomains) they stay absolute; on any other address they are paths on it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const { HOME_URL, wsUrl, withRequest, onHub } = require(path.join(APP, 'urls.js'));
const { hubDomain } = require(path.join(APP, 'workspaces.js'));
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

const req = (host) => ({ headers: { host } });

test('outside a request the links are the hub\'s, as they always were', () => {
  assert.equal(HOME_URL(), `https://${hubDomain()}`);
  assert.equal(wsUrl('dev'), `https://dev.${hubDomain()}`);
  assert.equal(wsUrl('dev', '/backups'), `https://dev.${hubDomain()}/backups`);
});

test('on the hub and on a workspace subdomain they stay absolute', () => {
  for (const host of [hubDomain(), `dev.${hubDomain()}`, `${hubDomain()}:443`, `DEV.${hubDomain().toUpperCase()}`]) {
    assert.ok(onHub(host), host);
    withRequest(req(host), () => {
      assert.equal(HOME_URL(), `https://${hubDomain()}`, host);
      assert.equal(wsUrl('docs'), `https://docs.${hubDomain()}`, host);
    });
  }
});

test('on any other address they are paths on that address', () => {
  for (const host of ['localhost:3996', '127.0.0.1:3000', '192.168.1.20', `${hubDomain()}.example.org`, `not${hubDomain()}`]) {
    assert.ok(!onHub(host), host);
    withRequest(req(host), () => {
      assert.equal(HOME_URL(), '/', host);
      assert.equal(wsUrl('dev'), '/dev', host);
      assert.equal(wsUrl('dev', '/backups'), '/dev/backups', host);
    });
  }
});

test('the address is kept across awaits, and two requests answered at once keep their own', async () => {
  const later = (ms) => new Promise((r) => setTimeout(r, ms));
  const [a, b] = await Promise.all([
    withRequest(req('localhost:3996'), async () => { await later(15); return [HOME_URL(), wsUrl('dev')]; }),
    withRequest(req(`dev.${hubDomain()}`), async () => { await later(5); return [HOME_URL(), wsUrl('dev')]; }),
  ]);
  assert.deepEqual(a, ['/', '/dev']);
  assert.deepEqual(b, [`https://${hubDomain()}`, `https://dev.${hubDomain()}`]);
});

test('every request the server answers is answered inside its context', () => {
  assert.match(server, /const server = http\.createServer\(\(req, res\) => withRequest\(req, \(\) => onRequest\(req, res\)\)\);/);
  assert.match(server, /\nasync function onRequest\(req, res\) \{\n/);
  // The logo and the rail's "All workspaces" use HOME_URL(), the cards and backups wsUrl().
  assert.match(server, /class="uk-navbar-item uk-logo toolbar-logo" href="\$\{HOME_URL\(\)\}"/);
  assert.match(server, /navLink\(HOME_URL\(\), 'home', 'All workspaces'/);
});
