/**
 * Who can reach the dashboard: where it listens, and the host names it answers to.
 *
 * Started with node on a machine it listened on every interface, so another device on the network could
 * post an action or open a terminal; and it answered any Host, so a page of another site whose name was
 * pointed at 127.0.0.1 (DNS rebinding) passed the same-origin check with its own name as Host and Origin.
 * Unit checks of request-guard.mts, then a real server over a temp workspace tree.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

import * as guard from '../../request-guard.mts';

const APP = path.join(import.meta.dirname, '../..');
const REPO = path.join(APP, '../..');
import { copyConfig } from './_isolated-config.js';

test('the names a request is answered under', () => {
  const hub = 'workspace.ddev.site';
  for (const ok of ['localhost:3000', 'LOCALHOST', '127.0.0.1:3999', '192.168.0.12:3000', '[::1]:3000', '::1',
    'workspace.ddev.site', 'dev.workspace.ddev.site:443', 'site1.ddev.site', 'app.localhost', '', undefined]) {
    assert.strictEqual(guard.hostAllowed(ok, { hub }), true, `${ok} is answered`);
  }
  for (const no of ['rebind.example:3999', 'rebind.example', 'workspace.ddev.site.evil.example', 'evilddev.site',
    'localhost.evil.example', 'notlocalhost', 'example.org']) {
    assert.strictEqual(guard.hostAllowed(no, { hub }), false, `${no} is refused`);
  }
  assert.strictEqual(guard.hostAllowed('hub.example.org', { hub: 'hub.example.org' }), true, 'a hub on its own domain');
  assert.strictEqual(guard.hostAllowed('dev.hub.example.org:443', { hub: 'hub.example.org' }), true, 'and its workspaces');
  const extra = guard.extraHosts({ WORKSPACE_ALLOWED_HOSTS: 'box.lan, *.team.example' });
  assert.deepStrictEqual(extra, ['box.lan', '.team.example']);
  assert.strictEqual(guard.hostAllowed('box.lan:3000', { hub, extra }), true);
  assert.strictEqual(guard.hostAllowed('a.team.example', { hub, extra }), true);
  assert.strictEqual(guard.hostAllowed('team.example', { hub, extra }), true);
  assert.strictEqual(guard.hostAllowed('box.lan.evil.example', { hub, extra }), false);
  assert.match(guard.refusalText('rebind.example:3999'), /does not answer to the name rebind\.example\..*WORKSPACE_ALLOWED_HOSTS/s);
});

test('where it listens: 127.0.0.1 on a machine, every interface in a container, or what WORKSPACE_LISTEN says', () => {
  const none = () => false;
  assert.strictEqual(guard.listenHost({ env: {}, exists: none }), '127.0.0.1');
  assert.strictEqual(guard.listenHost({ env: { IS_DDEV_PROJECT: 'true' }, exists: none }), undefined);
  assert.strictEqual(guard.listenHost({ env: {}, exists: (f) => f === '/.dockerenv' }), undefined);
  assert.strictEqual(guard.listenHost({ env: { WORKSPACE_LISTEN: '0.0.0.0' }, exists: none }), '0.0.0.0');
  assert.strictEqual(guard.listenHost({ env: { WORKSPACE_LISTEN: '0.0.0.0', IS_DDEV_PROJECT: 'true' }, exists: none }), '0.0.0.0');
  // The banner names a socket open past loopback on a machine, and nothing else.
  assert.strictEqual(guard.bindExposure({ env: {}, exists: none, address: '127.0.0.1' }), '');
  assert.strictEqual(guard.bindExposure({ env: {}, exists: none, address: '::1' }), '');
  assert.match(guard.bindExposure({ env: {}, exists: none, address: '::' }), /every interface of this machine/);
  assert.match(guard.bindExposure({ env: {}, exists: none, address: '192.168.0.12' }), /listens on 192\.168\.0\.12/);
  assert.strictEqual(guard.bindExposure({ env: { IS_DDEV_PROJECT: 'true' }, exists: none, address: '::' }), '', 'a container is fronted by the router');
});

// ---------------------------------------------------------------- a real server
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-request-guard-'));
let proc: ChildProcess | undefined;
let port = 0;
let log = '';

const free = (): Promise<number> => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(root, 'dev', 'site1'), { recursive: true });
  port = await free();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  delete env.IS_DDEV_PROJECT; delete env.WORKSPACE_LISTEN; delete env.WORKSPACE_ALLOWED_HOSTS;
  const server = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc = server;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    server.stdout.on('data', (d: Buffer) => { log += d; if (/listening/.test(log)) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

/** A request with the Host (and Origin) a browser would send for that name. */
/** What a request answered: its status (0 when it could not be made) and its body. */
interface Answer { status: number | undefined; text: string }

function ask(method: string, pathname: string, host: string,
  { origin = null, body = null, upgrade = false }: { origin?: string | null; body?: string | null; upgrade?: boolean } = {}): Promise<Answer> {
  return new Promise((resolve) => {
    const headers: http.OutgoingHttpHeaders = { Host: host };
    if (origin) headers.Origin = origin;
    if (body) Object.assign(headers, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) });
    if (upgrade) Object.assign(headers, { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' });
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, text: '' }); });
    req.on('error', (err) => resolve({ status: 0, text: err.message }));
    if (body) req.write(body);
    req.end();
  });
}

test('started with node on a machine, it listens on 127.0.0.1 and says so', () => {
  assert.match(log, new RegExp(`listening on 127\\.0\\.0\\.1:${port}`));
});

test('a page reached under a name that is not the dashboard\'s is refused: pages, actions, the terminal socket', async () => {
  const rebind = `rebind.example:${port}`;
  const page = await ask('GET', '/', rebind);
  assert.strictEqual(page.status, 403);
  assert.match(page.text, /does not answer to the name rebind\.example/);
  assert.strictEqual((await ask('GET', '/settings/settings.yml', rebind)).status, 403);
  const note = path.join(root, 'dev', 'site1', '.workspace-note');
  const posted = await ask('POST', '/actions/note-save', rebind, { origin: `http://${rebind}`, body: 'workspace=dev&projectName=site1&title=rebound' });
  assert.strictEqual(posted.status, 403, 'the same-origin check alone let this through');
  assert.ok(!fs.existsSync(note), 'nothing was written');
  const socket = await ask('GET', '/ws/screen/dev--site1--x', rebind, { origin: `http://${rebind}`, upgrade: true });
  assert.notStrictEqual(socket.status, 101, 'no terminal under a rebound name');
});

test('its own names are answered as before', async () => {
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, 'workspace.ddev.site', 'dev.workspace.ddev.site']) {
    assert.strictEqual((await ask('GET', '/', host)).status, 200, host);
  }
  const posted = await ask('POST', '/actions/note-save', `127.0.0.1:${port}`, { origin: `http://127.0.0.1:${port}`, body: 'workspace=dev&projectName=site1&title=here' });
  assert.strictEqual(posted.status, 200, posted.text);
  const evil = await ask('POST', '/actions/note-save', `127.0.0.1:${port}`, { origin: 'http://evil.example', body: 'workspace=dev&projectName=site1&title=there' });
  assert.strictEqual(evil.status, 403, 'another site is still refused by its Origin');
});
