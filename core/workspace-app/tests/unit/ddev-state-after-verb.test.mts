/**
 * After Stop, Start or Restart on a DDEV project, its row shows the state the verb left, without a reload (#766).
 *
 * DDEV's states come from one `ddev list` the dashboard keeps for 15 seconds and never waits for. A verb that changes
 * a project's state runs in a screen session the page watches (/fragments/session-done/<session>); when it ends, the
 * list is read again before the page is told, so the rows it redraws are the new ones.
 *
 * Against a real server over a temp workspace, with stand-in ddev and screen on PATH: ddev answers `list` with the
 * state in flags/state and counts the times it is asked; screen runs nothing, so every session has ended.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyConfig } from './_isolated-config.js';

const APP = path.join(import.meta.dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ddev-state-'));
const bin = path.join(root, 'bin');
const flags = path.join(root, 'flags');
const site = path.join(root, 'dev', 'ddev-site');
let proc: ChildProcess | undefined;
let base = '';

const free = (): Promise<number> => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolve(typeof a === 'object' && a ? a.port : 0)); });
});
const standIn = (name: string, body: string): void => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
const setState = (state: string): void => fs.writeFileSync(path.join(flags, 'state'), state);
const lists = (): number => (fs.existsSync(path.join(flags, 'lists')) ? fs.readFileSync(path.join(flags, 'lists'), 'utf8').trim().split('\n').length : 0);

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  fs.mkdirSync(bin); fs.mkdirSync(flags);
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(path.join(site, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(site, '.ddev', 'config.yaml'), 'name: ddev-site\ntype: drupal\ndocroot: web\n');
  setState('running');
  standIn('ddev', `case "$*" in
  "list --json-output") echo list >> "${flags}/lists"
    echo "{\\"raw\\":[{\\"name\\":\\"ddev-site\\",\\"status\\":\\"$(cat "${flags}/state")\\",\\"approot\\":\\"${site}\\",\\"primary_url\\":\\"https://ddev-site.ddev.site\\"}]}" ;;
  *) echo "ddev $*" >> "${flags}/calls" ;;
esac`);
  standIn('screen', `case "$1" in --version) echo "Screen version 4.09 (stand-in)" ;; -ls) echo "No Sockets found." ; exit 1 ;; *) true ;; esac`);
  const port = await free();
  base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  for (const k of ['WORKSPACE_PATH', 'WORKSPACE_SCRIPTS', 'WORKSPACE_CONFIG']) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc = child;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    child.stdout?.on('data', (d: Buffer) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = async (p: string): Promise<{ html: string, trigger: string }> => {
  const r = await fetch(base + p);
  return { html: await r.text(), trigger: r.headers.get('hx-trigger') || '' };
};
const post = async (p: string, form: Record<string, string>): Promise<string> => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  return r.text();
};
/** The state word on the row's chip. */
const chip = async (): Promise<string> => {
  const m = (await get('/fragments/dev/projects')).html.match(/state-toggle[^>]*hx-vals='\{"workspace":"dev","projectName":"ddev-site"\}'[\s\S]*?<span class="state-word">(\w+)<\/span>/);
  return m ? m[1] : '';
};
const watcherOf = (html: string): string => (html.match(/class="session-watch" hx-get="\/fragments\/session-done\/([^"]+)"/) || [])[1] || '';

test('Stop: the page watches the session, and once it ends the row says Stopped with no reload (#766)', async () => {
  assert.strictEqual(await chip(), 'Running');
  setState('stopped');
  const answer = await post('/actions/ddev-stop', { workspace: 'dev', projectName: 'ddev-site' });
  assert.strictEqual(watcherOf(answer), 'dev--ddev-site--stop', 'the page hears when the session is done');
  assert.doesNotMatch(answer, /data-reload-on-close/, 'and is not reloaded as the notice leaves');
  // Until the session ends, the list kept is the one read before: that is what a page is given at once.
  assert.strictEqual(await chip(), 'Running');
  const before = lists();
  const done = await get('/fragments/session-done/dev--ddev-site--stop');
  assert.strictEqual(done.html, '', 'the watcher is done');
  assert.match(done.trigger, /refresh-projects/, 'and the rows are drawn again');
  assert.strictEqual(lists(), before + 1, 'DDEV\'s list was read again before the page was told');
  assert.strictEqual(await chip(), 'Stopped');
  assert.match((await get('/fragments/dev/projects')).html, /hx-post="\/actions\/ddev-start"[^>]*hx-vals='\{"workspace":"dev","projectName":"ddev-site"\}'/, 'with Start on it');
  // A second watcher for the same session reads nothing again.
  await get('/fragments/session-done/dev--ddev-site--stop');
  assert.strictEqual(lists(), before + 1);
});

test('Start and Restart do the same; a verb that changes no state, and a session of something else, read nothing (#766)', async () => {
  setState('running');
  assert.strictEqual(watcherOf(await post('/actions/ddev-start', { workspace: 'dev', projectName: 'ddev-site' })), 'dev--ddev-site--start');
  await get('/fragments/session-done/dev--ddev-site--start');
  assert.strictEqual(await chip(), 'Running');
  setState('stopped');
  assert.strictEqual(watcherOf(await post('/actions/ddev-restart', { workspace: 'dev', projectName: 'ddev-site' })), 'dev--ddev-site--restart');
  await get('/fragments/session-done/dev--ddev-site--restart');
  assert.strictEqual(await chip(), 'Stopped', 'the list after a restart is what DDEV says, whatever it is');
  const before = lists();
  const describe = await post('/actions/ddev-describe', { workspace: 'dev', projectName: 'ddev-site' });
  assert.strictEqual(watcherOf(describe), '', 'describe changes nothing, and is not watched');
  await get('/fragments/session-done/dev--ddev-site--describe');
  await get('/fragments/session-done/dev--nobody--nothing');
  assert.strictEqual(lists(), before, 'no list is read for a session that changed no DDEV state');
});
