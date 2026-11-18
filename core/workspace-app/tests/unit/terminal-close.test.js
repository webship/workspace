/**
 * Closing a terminal leaves nothing attached.
 *
 * A terminal is `script` running `screen -x <session>` on a pty. Closing it sent SIGHUP to script's process
 * group: `script` carries on after a SIGHUP, and the screen client is not in that group (script gives it a
 * session of its own), so both stayed, attached, one more for every window ever opened and closed. Against a
 * real server, with a `screen` stand-in whose attach waits like a client and writes down its pid.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const hasScript = spawnSync('script', ['--version']).status === 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-terminal-close-'));
const pidFile = path.join(root, 'client.pid');
let proc;
let port;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

before(async () => {
  if (!hasScript) return;
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // screen -A -x <session>: a client that stays attached until its terminal hangs up.
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;; -ls) exit 1 ;; -A) echo $$ > ${JSON.stringify(pidFile)}; exec sleep 300 ;; esac
exit 0
`, { mode: 0o755 });
  port = await free();
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  try { const pid = Number(fs.readFileSync(pidFile, 'utf8')); if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch (_) { /* none */ }
  fs.rmSync(root, { recursive: true, force: true });
});

test('a terminal closed in the browser leaves no client attached', { skip: !hasScript && 'script(1) is not installed' }, async () => {
  const WebSocket = require('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/screen/dev--site1--x?cols=100&rows=30`);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  let pid = 0;
  for (let i = 0; i < 50 && !pid; i += 1) {
    await wait(100);
    try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch (_) { pid = 0; }
  }
  assert.ok(pid && alive(pid), 'the client attached');
  ws.close(1000);
  for (let i = 0; i < 30 && alive(pid); i += 1) await wait(100);
  assert.strictEqual(alive(pid), false, 'the client is gone once the terminal is closed');
  const left = spawnSync('pgrep', ['-f', 'exec screen -A -x dev--site1--x'], { encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(left, '', 'and so is script');
});
