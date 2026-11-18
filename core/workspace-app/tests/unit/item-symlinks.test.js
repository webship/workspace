/**
 * A link in a workspace folder that leads out of it is not read or written through.
 *
 * An item can be a link (a folder synced from a repository can hold `notes.md -> ~/.bashrc`): the doc and AI
 * item editor showed the file it pointed at, Save wrote to it, and the review window read a linked file. A
 * link that leads nowhere would have been created by a write. Against a real server over a temp tree, with
 * the files outside it as the decoys.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-item-links-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-item-links-outside-'));
const SECRET = 'OUTSIDE-THE-WORKSPACE-7f3a';
let proc;
let base;

const free = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), `${SECRET}\n`);
  const docs = path.join(root, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'plain.md'), '# Plain\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(docs, 'link.md'));
  fs.symlinkSync(path.join(outside, 'not-yet.txt'), path.join(docs, 'dangling.md'));
  fs.symlinkSync(path.join(docs, 'plain.md'), path.join(docs, 'alias.md'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(docs, 'AGENTS.md'));
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return { status: r.status, text: await r.text() };
};
const secret = () => fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8');

test('the editor and the review window do not read a linked file outside the folder', async () => {
  for (const p of ['/fragments/docs/edit/link', '/fragments/docs/review/link.md']) {
    const r = await get(p);
    assert.ok(r.status >= 400, `${p} answers ${r.status}`);
    assert.ok(!r.text.includes(SECRET), `${p} does not show the outside file`);
  }
});

test('Save does not write through a link out of the folder, nor create where a dangling one points', async () => {
  let r = await post('/actions/save-item', { workspace: 'docs', name: 'link', content: 'written through the link' });
  assert.strictEqual(r.status, 400, r.text);
  assert.match(r.text, /link out of its workspace folder/);
  assert.strictEqual(secret(), `${SECRET}\n`, 'the file outside is unchanged');
  r = await post('/actions/save-item', { workspace: 'docs', name: 'dangling', content: 'x' });
  assert.strictEqual(r.status, 400, r.text);
  assert.ok(!fs.existsSync(path.join(outside, 'not-yet.txt')), 'nothing was created outside');
  r = await post('/actions/save-doc', { workspace: 'docs', file: 'AGENTS.md', content: 'x' });
  assert.strictEqual(r.status, 400, r.text);
  assert.strictEqual(secret(), `${SECRET}\n`, 'the folder doc link wrote nothing either');
});

test('ordinary docs, and a link that stays inside the folder, work as before', async () => {
  let r = await get('/fragments/docs/edit/plain');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /# Plain/);
  r = await post('/actions/save-item', { workspace: 'docs', name: 'plain', content: '# Plain, edited\n' });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(fs.readFileSync(path.join(root, 'docs', 'plain.md'), 'utf8'), '# Plain, edited\n');
  r = await get('/fragments/docs/edit/alias');
  assert.strictEqual(r.status, 200, 'a link to another doc of the folder is read');
  r = await post('/actions/save-item', { workspace: 'docs', name: 'new-doc', content: '# New\n' });
  assert.strictEqual(r.status, 200, r.text);
});
