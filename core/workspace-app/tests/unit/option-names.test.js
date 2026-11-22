/**
 * A name is never read as an option.
 *
 * The project name rule allowed a leading dash, and the name is passed to the workspace's scripts as their
 * first argument: Remove with the name `--orphans` listed the machine's orphan containers instead of
 * removing anything, Backup with `--help` printed its help. The plugin spec allowed one too: `--dry-run`
 * in its place reached `npm install` as an option. Refused at the door now, with the reason.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const { NAME_RE } = require('../../validate.mts');

const APP = path.join(__dirname, '../..');
const REPO = path.join(APP, '../..');
const { copyConfig } = require('./_isolated-config');

test('the name rule: letters, digits, _ and -, never a dash first', () => {
  for (const ok of ['site1', 'd11x00b1', '_scratch', 'a-b_c', 'A1']) assert.ok(NAME_RE.test(ok), ok);
  for (const no of ['--orphans', '--help', '-rf', '-', '--', 'a b', 'a/b', '..', '']) assert.ok(!NAME_RE.test(no), no);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-option-names-'));
const asked = path.join(root, 'asked.txt');
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
  const dev = path.join(root, 'dev');
  fs.mkdirSync(path.join(dev, 'site1'), { recursive: true });
  for (const f of ['cmd-tools-remove.sh', 'cmd-tools-backup-dev.sh', 'cmd-tools-test-project.sh']) {
    fs.writeFileSync(path.join(dev, f), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(dev, 'cmd-names-project.sh'), '#!/bin/sh\n# workspace-name: Names\nexit 0\n', { mode: 0o755 });
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // screen(1), as a stand-in that writes down what it was asked to start.
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh\ncase "$1" in --version) echo "Screen version 4.09.01"; exit 0 ;; -ls) exit 1 ;; esac\nprintf '%s\\n' "$*" >> ${JSON.stringify(asked)}\nexit 0\n`, { mode: 0o755 });
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server.js'], { cwd: APP, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout.on('data', (d) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const post = async (p, form) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return { status: r.status, text: await r.text() };
};
const started = () => (fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8') : '');

test('Remove, Backup and Build refuse a project name that a script would read as an option', async () => {
  for (const name of ['--orphans', '--help', '-rf']) {
    let r = await post('/actions/remove', { workspace: 'dev', projectName: name, confirm: 'yes', confirm_name: name });
    assert.strictEqual(r.status, 400, `remove ${name}`);
    assert.match(r.text, /Invalid project name/);
    r = await post('/actions/backup', { workspace: 'dev', projectName: name });
    assert.strictEqual(r.status, 400, `backup ${name}`);
    r = await post('/actions/build', { workspace: 'dev', script: 'cmd-names-project.sh', projectName: name });
    assert.strictEqual(r.status, 400, `build ${name}`);
  }
  assert.strictEqual(started(), '', 'nothing was started');
  // A name without a leading dash is taken as before.
  const r = await post('/actions/backup', { workspace: 'dev', projectName: 'site1' });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(started(), /cmd-tools-backup-dev\.sh' 'site1'|cmd-tools-backup-dev\.sh" "site1"/);
});

test('a plugin spec that npm would read as an option is refused', async () => {
  for (const spec of ['--dry-run', '-g', '--global']) {
    const r = await post('/actions/plugins', { verb: 'require', spec });
    assert.strictEqual(r.status, 400, spec);
    assert.match(r.text, /not a package spec/);
  }
});
