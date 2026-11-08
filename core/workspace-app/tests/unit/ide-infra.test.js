/**
 * The Web IDE's infrastructure stays with the dashboard image: code-server as a supervised daemon
 * bound to loopback, and the nginx vhost that proxies the ide. host to it. The menu that opens it
 * is the IDE plugin's (@webship.co/workspace-ide), which expects this same address.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const BIND = '127.0.0.1:8443';

test('the start script binds code-server to loopback only, where the plugin and nginx expect it', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'code-server-start.sh'), 'utf8');
  assert.ok(sh.includes(`--bind-addr ${BIND}`), 'the start script binds elsewhere');
});

test('the daemon runs that script', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', '.ddev', 'config.yaml'), 'utf8');
  assert.match(cfg, /name: "code-server"/);
  assert.match(cfg, /command: "bash scripts\/code-server-start\.sh"/);
});

test('nginx proxies the IDE hostname to that same port, with websocket upgrade', () => {
  const conf = fs.readFileSync(path.join(__dirname, '..', '..', '.ddev', 'nginx_full', 'nginx-site.conf'), 'utf8');
  assert.ok(conf.includes(`proxy_pass http://${BIND}`), 'vhost points elsewhere');
  assert.match(conf, /proxy_set_header Upgrade/);
});
