const { test } = require('node:test');
const assert = require('node:assert');

const { ideBaseUrl, IDE_HOST, IDE_BIND } = require('../../urls');

test('the IDE hostname follows hub_domain rather than being written down twice', () => {
  const { hubDomain } = require('../../workspaces');
  assert.equal(IDE_HOST(), `ide.${hubDomain()}`);
  assert.equal(ideBaseUrl(), `https://ide.${hubDomain()}`);
});

test('the IDE binds to loopback, so the vhost is the only way in', () => {
  // If this ever becomes 0.0.0.0 the editor is reachable on the LAN without going through
  // the ide.* vhost — and it has a terminal and write access to the whole tree.
  assert.equal(IDE_BIND.host, '127.0.0.1');
  assert.equal(typeof IDE_BIND.port, 'number');
});

test('the start script binds where the code expects, and only on loopback', () => {
  // Declared in a different file from the code and would drift silently: the button
  // would point at a hostname nginx proxies to a port nothing listens on.
  const fs = require('fs');
  const path = require('path');
  const sh = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'code-server-start.sh'), 'utf8');
  assert.ok(sh.includes(`--bind-addr ${IDE_BIND.host}:${IDE_BIND.port}`),
    'the start script binds elsewhere than IDE_BIND');
  assert.ok(!/--bind-addr\s+0\.0\.0\.0/.test(sh),
    'bound to 0.0.0.0 — that puts an editor with a terminal and full write access on the LAN');
  assert.ok(sh.includes('--auth none'), 'auth flag changed — the README documents this posture');
  // Workspace Trust off is what lets the terminal start without a prompt per folder.
  assert.ok(sh.includes('"security.workspace.trust.enabled": false'),
    'workspace trust re-enabled — the terminal will refuse to start until prompted');
});

test('the daemon runs that script', () => {
  const fs = require('fs');
  const path = require('path');
  const yml = fs.readFileSync(path.join(__dirname, '..', '..', '.ddev', 'config.yaml'), 'utf8');
  assert.match(yml, /name: "code-server"/);
  assert.match(yml, /command: "bash scripts\/code-server-start\.sh"/);
});

test('nginx proxies the IDE hostname to that same port, with websocket upgrade', () => {
  const fs = require('fs');
  const path = require('path');
  const conf = fs.readFileSync(path.join(__dirname, '..', '..', '.ddev', 'nginx_full', 'nginx-site.conf'), 'utf8');
  assert.match(conf, /server_name\s+ide\.workspace\.ddev\.site;/, 'no exact ide vhost');
  assert.ok(conf.includes(`proxy_pass http://${IDE_BIND.host}:${IDE_BIND.port}`), 'vhost points elsewhere');
  // Without these the editor loads and then hangs "reconnecting…" — the terminal, the
  // extension host and the file watcher are all websockets.
  assert.match(conf, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(conf, /proxy_set_header Connection \$connection_upgrade;/);
  assert.match(conf, /map \$http_upgrade \$connection_upgrade/, 'no upgrade map defined');
});
