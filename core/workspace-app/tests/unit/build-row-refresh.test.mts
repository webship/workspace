/**
 * After a build started from a folder's Build form, the project's row shows the state the build left, without a
 * reload (#894), the way it does after Stop, Start or Restart (#766).
 *
 * A build runs in a screen session; it used to reload the page as its notice left, at the start of the build, and
 * nothing told the page when the build ended, so the row kept "Stopped" until a reload. The build's session is now
 * watched (/fragments/session-done/<session>): when it ends, DDEV's list is read again before the page is told.
 *
 * Against a real server over a temp workspace, with stand-in ddev and screen on PATH and a builder of the dev folder:
 * ddev answers `list` with the state in flags/state and counts the times it is asked; screen runs nothing, so every
 * session has ended.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-state-'));
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
  // The folder's builder, the one the Build form offers: it would build ddev-site.
  fs.writeFileSync(path.join(root, 'dev', 'cmd-example-project.sh'), '#!/usr/bin/env bash\n# workspace-name: Example\necho "built $1"\n', { mode: 0o755 });
  setState('stopped');
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

test('a build: the page watches its session, and once it ends the row says Running with no reload (#894)', async () => {
  assert.strictEqual(await chip(), 'Stopped', 'before the build, the project is stopped');
  const answer = await post('/actions/build', { workspace: 'dev', script: 'cmd-example-project.sh', projectName: 'ddev-site' });
  assert.strictEqual(watcherOf(answer), 'dev--ddev-site--build', 'the page hears when the build is done');
  assert.doesNotMatch(answer, /data-reload-on-close/, 'and is not reloaded as the notice leaves, while the build runs');
  // The build starts the project; until its session ends, the list kept is the one read before.
  setState('running');
  assert.strictEqual(await chip(), 'Stopped');
  const before = lists();
  const done = await get('/fragments/session-done/dev--ddev-site--build');
  assert.strictEqual(done.html, '', 'the watcher is done');
  assert.match(done.trigger, /refresh-projects/, 'and the rows are drawn again');
  assert.strictEqual(lists(), before + 1, 'DDEV\'s list was read again before the page was told');
  assert.strictEqual(await chip(), 'Running', 'the row says what the build left');
  // A second watcher for the same session reads nothing again.
  await get('/fragments/session-done/dev--ddev-site--build');
  assert.strictEqual(lists(), before + 1);
});

test('a build that cannot start is not watched, and the quick build is watched too (#894)', async () => {
  const unknown = await post('/actions/build', { workspace: 'dev', script: 'cmd-nothing-project.sh', projectName: 'ddev-site' });
  assert.strictEqual(watcherOf(unknown), '', 'an unknown builder starts nothing, and nothing is watched');
  assert.match(unknown, /Unknown build script/);
  const quick = await post('/actions/quick-build', { workspace: 'dev', script: 'cmd-example-project.sh', projectName: 'ddev-site' });
  assert.strictEqual(watcherOf(quick), 'dev--ddev-site--build', 'the quick build is the same session, watched the same way');
  await get('/fragments/session-done/dev--ddev-site--build');
});
