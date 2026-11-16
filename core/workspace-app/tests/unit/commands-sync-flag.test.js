/**
 * commands/cmd-tools-commands.sh --sync: the flag the help offers must reach commands_sync. It was
 * declared in arg-commands.sh and never dispatched, so `--sync` printed the plain list.
 *
 * The run is against a temporary workspace whose mirror of the tooling repository is a local git
 * repository, so nothing here reaches the network (gh is a stand-in on PATH that says "not logged in").
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const APP = path.join(__dirname, '..', '..');
const SCRIPTS = path.join(APP, '..', 'scripts');
const COMMAND = path.join(APP, '..', '..', 'commands', 'cmd-tools-commands.sh');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=1.0.x', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
};

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cmd-sync-'));
  const config = path.join(root, 'core', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'settings.yml'), 'workspaces:\n  - dev\n');
  fs.mkdirSync(path.join(root, 'dev'));
  fs.mkdirSync(path.join(root, 'commands'));
  fs.copyFileSync(COMMAND, path.join(root, 'commands', 'cmd-tools-commands.sh'));
  fs.writeFileSync(path.join(root, 'dev', 'cmd-tools-mine.sh'), '#!/usr/bin/env bash\necho mine\n');
  // The tooling repository: one command this workspace lacks, one it has with other content.
  const upstream = path.join(root, 'upstream');
  fs.mkdirSync(path.join(upstream, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(upstream, 'dev', 'cmd-tools-new.sh'), '#!/usr/bin/env bash\necho new\n');
  fs.writeFileSync(path.join(upstream, 'dev', 'cmd-tools-mine.sh'), '#!/usr/bin/env bash\necho theirs\n');
  git(upstream, 'init', '-q');
  git(upstream, 'add', '-A');
  git(upstream, 'commit', '-q', '-m', 'tooling');
  git(root, 'clone', '-q', upstream, path.join(root, 'commands', 'workspace-repo'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  return { root, config, bin };
}

function run(t, ...args) {
  const env = { ...process.env, PATH: `${t.bin}:${process.env.PATH}`, WORKSPACE_SCRIPTS: SCRIPTS, WORKSPACE_ROOT: t.root, WORKSPACE_CONFIG: t.config,
    WORKSPACE_PATH: path.join(t.root, 'core'), WORKSPACE_REPO: 'example/tooling', WORKSPACE_REPO_REF: '1.0.x' };
  return spawnSync('bash', [path.join(t.root, 'commands', 'cmd-tools-commands.sh'), ...args], { cwd: path.join(t.root, 'commands'), env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('--sync reports what would change and writes nothing', () => {
  const t = tree();
  const r = run(t, '--sync');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Sync from example\/tooling@1\.0\.x/);
  assert.match(r.stdout, /missing\s+dev\/cmd-tools-new\.sh/);
  assert.match(r.stdout, /differs\s+dev\/cmd-tools-mine\.sh/);
  assert.match(r.stdout, /Nothing has been written/);
  assert.strictEqual(fs.existsSync(path.join(t.root, 'dev', 'cmd-tools-new.sh')), false);
});

test('--sync --confirm takes the missing ones and leaves the ones that differ', () => {
  const t = tree();
  const r = run(t, '--sync', '--confirm');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /took\s+dev\/cmd-tools-new\.sh/);
  assert.match(fs.readFileSync(path.join(t.root, 'dev', 'cmd-tools-new.sh'), 'utf8'), /echo new/);
  assert.match(fs.readFileSync(path.join(t.root, 'dev', 'cmd-tools-mine.sh'), 'utf8'), /echo mine/);
  assert.match(r.stdout, /1 left alone because they differ/);
});

test('--sync --confirm --overwrite replaces the ones that differ and keeps a copy', () => {
  const t = tree();
  const r = run(t, '--sync', '--confirm', '--overwrite');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(fs.readFileSync(path.join(t.root, 'dev', 'cmd-tools-mine.sh'), 'utf8'), /echo theirs/);
  const kept = fs.readdirSync(path.join(t.root, 'backups', 'commands'));
  assert.strictEqual(kept.length, 1);
  assert.match(fs.readFileSync(path.join(t.root, 'backups', 'commands', kept[0]), 'utf8'), /echo mine/);
});

test('every flag arg-commands.sh declares is read by the command', () => {
  const args = fs.readFileSync(path.join(SCRIPTS, 'args', 'arg-commands.sh'), 'utf8');
  const script = fs.readFileSync(COMMAND, 'utf8');
  const dests = [...args.matchAll(/add_argument\('-\w',\s*'--([a-z-]+)'/g)].map((m) => m[1].replace(/-/g, '_').toUpperCase());
  assert.ok(dests.includes('SYNC') && dests.includes('OVERWRITE'), 'the argument file still offers --sync and --overwrite');
  // --list is the default: what runs when no other flag is given.
  for (const dest of dests.filter((d) => d !== 'LIST')) assert.ok(script.includes(`\${${dest}}`), `--${dest.toLowerCase().replace(/_/g, '-')} is declared and never read`);
});
