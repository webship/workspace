/**
 * No page of the dashboard shows the full home path: paths read ~/workspace/..., as tildePath() writes them (webship/workspace#673).
 *
 * The Folder docs line of every items workspace, the empty-folder hint of the instance workspaces and Settings →
 * Buttons → Start again printed /home/<user>/workspace/..., the user's name on screen and in every screenshot.
 * This crawls a dashboard whose workspace is inside HOME: every page the palette lists, every tab of Settings,
 * and every fragment those load by themselves, and finds the home path in none of them. plugins.sh writes its
 * paths with ~ the same way.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');
const { copyConfig } = require('./_isolated-config');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-home-path-'));
const root = path.join(home, 'workspace');
let proc;
let base;
const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, WORKSPACE_PLUGINS_NO_RESTART: '1', HOME: home } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(home, { recursive: true, force: true });
});

const get = async (u) => (await fetch(base + u, { headers: u.startsWith('/fragments') ? { 'HX-Request': 'true' } : {} })).text();

test('no page, Settings tab or fragment they load shows the home path', async () => {
  const data = JSON.parse(await get('/fragments/palette.json'));
  // Each workspace folder with the files its Folder docs line lists, so the line is drawn.
  for (const w of data.workspaces) {
    fs.mkdirSync(path.join(root, w.key), { recursive: true });
    fs.writeFileSync(path.join(root, w.key, 'README.md'), `# ${w.key}\n`);
  }
  const seen = new Set();
  const found = [];
  const scan = async (u, depth) => {
    if (seen.has(u) || seen.size > 400) return;
    seen.add(u);
    const html = await get(u);
    const at = html.indexOf(home);
    if (at >= 0) found.push(`${u}: …${html.slice(Math.max(0, at - 80), at + 60).replace(/\s+/g, ' ')}…`);
    if (depth <= 0) return;
    for (const m of html.matchAll(/hx-get="([^"]+)"[^>]*hx-trigger="[^"]*(?:load|revealed|intersect)/g)) {
      const sub = m[1].replace(/&amp;/g, '&');
      if (sub.startsWith('/')) await scan(sub, depth - 1);
    }
  };
  for (const p of ['/', '/settings', '/screens', '/help', '/commands', ...data.workspaces.map((w) => `/${w.key}`)]) await scan(p, 2);
  const modal = await get('/fragments/settings/modal');
  for (const m of modal.matchAll(/class="tabmodal-tab[^"]*"[\s\S]*?hx-get="([^"]+)"/g)) await scan(m[1].replace(/&amp;/g, '&'), 1);
  assert.ok(seen.size > 40, `read ${seen.size} answers`);
  assert.deepStrictEqual(found, [], `the home path shows in:\n${found.join('\n')}`);
});

test('plugins.sh writes its paths with ~, as the dashboard does', () => {
  const sh = fs.readFileSync(path.join(REPO, 'core/scripts/plugins.sh'), 'utf8');
  const fn = sh.split('\n').find((l) => l.startsWith('tilde() {'));
  assert.ok(fn, 'the tilde helper');
  const run = (homeDir, p) => execFileSync('bash', ['-c', `${fn}\ntilde "$1"`, '_', p], { env: { ...process.env, HOME: homeDir }, encoding: 'utf8' });
  assert.strictEqual(run('/home/someone', '/home/someone/workspace/core/config/x.yml'), '~/workspace/core/config/x.yml');
  assert.strictEqual(run('/home/someone', '/home/someone'), '~');
  assert.strictEqual(run('/home/someone', '/home/someoneelse/x'), '/home/someoneelse/x', 'a sibling home stays as it is');
  assert.strictEqual(run('', '/home/someone/x'), '/home/someone/x', 'no HOME, no change');
  assert.strictEqual(run('/home/a b', '/home/a b/ws'), '~/ws');
  // Its paths: the settings of --configure and the restart command.
  assert.match(sh, /echo "Its settings: \$\(tilde "\$\{WORKSPACE_ROOT\}\/core\/config\/\$\{file\}"\)" ;;/);
  assert.match(sh, /echo "The settings of its folder: \$\(tilde "\$\{WORKSPACE_ROOT\}\/core\/config\/\$\{file\}"\)" ;;/);
  assert.match(sh, /echo " {2}cd \$\(tilde "\$\{APP\}"\) && ddev restart" ;/);
  assert.doesNotMatch(sh, /echo "[^"\n]*\$\{WORKSPACE_ROOT\}\/core\/config/, 'no full path left in what it says');
});

test('no hand-rolled shortening of HOME is left: with no HOME it put a ~ in front of every path', () => {
  for (const f of ['server.js', 'images-page.js', 'row-layout.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(APP, f), 'utf8'), /\.replace\(process\.env\.HOME \|\| '', '~'\)/, f);
  }
});
