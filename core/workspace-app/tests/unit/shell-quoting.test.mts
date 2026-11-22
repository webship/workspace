/**
 * What is typed into a form reaches the command as typed, and is never run by the shell.
 *
 * Values were put into the command lines with JSON.stringify(), a double-quoted word, in which bash still
 * runs $(…) and `…` and expands $VAR: a build argument, the prompt of a clone, the label of a new command,
 * the summary of a proposal, the purpose of a cloned item, the description of a generated one. A folder
 * name read from a project (its profile, for Add the test users) went in bare. Each is sent here with a
 * command substitution in it, to a real server whose `screen` stand-in runs the line it is given; the
 * scripts and `claude` are stand-ins that write down what they received.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

import { shq, shWords } from '../../shell-quote.mts';

const APP = path.join(import.meta.dirname, '../..');
const REPO = path.join(APP, '../..');
import { copyConfig } from './_isolated-config.js';

test('shq: what bash reads back is the value, whatever is in it', () => {
  const values = ['a$(touch /nonexistent/r10)b', '`id`', '$HOME and ${PATH}', "it's", '"q"', 'back\\slash', 'new\nline', '!bang', ';|&<>*?[]{}~', 'emoji \u{1F600}', ''];
  for (const v of values) {
    const out = spawnSync('bash', ['-c', `printf '%s' ${shq(v)}`]).stdout.toString();
    assert.strictEqual(out, v, JSON.stringify(v));
  }
  assert.strictEqual(spawnSync('bash', ['-c', `printf '%s|' ${shWords(['a b', '$x', ''])}`]).stdout.toString(), 'a b|$x||');
  assert.strictEqual(shq('a\0b'), "'ab'", 'a NUL cannot be in a shell word');
});

// ---------------------------------------------------------------- a real server
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-shell-quoting-'));
const bin = path.join(root, 'bin');
const ran = path.join(root, 'ran');          // where the canaries would land
let proc: ChildProcess | undefined;
let base = '';

const free = (): Promise<number> => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

/** A script that writes down the arguments it was given, one per line, beside itself. */
const recorder = (file: string, extra = ''): string => `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${shq(file)}\n${extra}exit 0\n`;

before(async () => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  fs.mkdirSync(ran);
  fs.mkdirSync(bin);
  // screen(1): asked to start a session, it runs the line in the folder it was started in, and returns.
  fs.writeFileSync(path.join(bin, 'screen'), `#!/bin/sh
case "$1" in --version) echo "Screen version 4.09.01 (stand-in)"; exit 0 ;; -ls) exit 1 ;; esac
for last; do :; done
bash -c "$last" > /dev/null 2>&1
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude'), recorder(path.join(root, 'claude-args.txt')), { mode: 0o755 });
  // dev: a builder whose --require takes a value, the clone and add-users tools, a project.
  const dev = path.join(root, 'dev');
  fs.mkdirSync(path.join(dev, 'site1', 'web', 'profiles', 'contrib', 'webship'), { recursive: true });
  fs.mkdirSync(path.join(dev, 'site1', '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dev, 'site1', '.ddev', 'config.yaml'), 'name: site1\ntype: drupal11\ndocroot: web\n');
  fs.writeFileSync(path.join(dev, 'cmd-quoting-project.sh'), `${recorder(path.join(dev, 'build-args.txt'))}argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME', help='The name of the project.')
parser.add_argument('--require', default='', help='More packages.')
EOF
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dev, 'cmd-tools-add-users.sh'), recorder(path.join(dev, 'users-args.txt')), { mode: 0o755 });
  fs.writeFileSync(path.join(dev, 'cmd-tools-clone.sh'), recorder(path.join(dev, 'clone-args.txt'), 'mkdir -p "$(dirname "$0")/$3"\n'), { mode: 0o755 });
  // commands/: the tool every command action shells out to.
  fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(root, 'commands', 'cmd-tools-commands.sh'), recorder(path.join(root, 'commands', 'args.txt')), { mode: 0o755 });
  // ai-agents: an item, and the tool of the folder.
  fs.mkdirSync(path.join(root, 'ai-agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ai-agents', 'one-agent.md'), '---\nname: one-agent\ndescription: Use this agent to be listed.\n---\n');
  fs.writeFileSync(path.join(root, 'ai-agents', 'cmd-tools-ai-items.sh'), recorder(path.join(root, 'ai-agents', 'args.txt')), { mode: 0o755 });

  const port = await free();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  const server = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc = server;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    server.stdout.on('data', (d: Buffer) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    server.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
});

after(() => {
  if (proc) proc.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

const post = async (p: string, form: Record<string, string>): Promise<{ status: number; text: string }> => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return { status: r.status, text: await r.text() };
};
const lines = (file: string): string[] | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : null);
/** A value that would leave a file in `ran/` if any shell ran it, and says which way. */
const hostile = (tag: string): string => `x $(touch ${ran}/${tag}-dollar) \`touch ${ran}/${tag}-tick\` $HOME 'q'`;
const nothingRan = () => assert.deepStrictEqual(fs.readdirSync(ran), [], 'no shell ran a value');

test('a build argument reaches the builder as typed', async () => {
  const value = `drupal/token ${hostile('build')}`;
  const r = await post('/actions/build', { workspace: 'dev', script: 'cmd-quoting-project.sh', projectName: 'site2', 'argv:--require': value });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'dev', 'build-args.txt')), ['site2', `--require=${value}`]);
  nothingRan();
});

test('the prompt of a clone reaches claude as typed', async () => {
  const r = await post('/actions/clone-project', { workspace: 'dev', projectName: 'site1', to: 'site1-copy', prompt: `Rename it ${hostile('clone')}` });
  assert.strictEqual(r.status, 200, r.text);
  const asked = lines(path.join(root, 'claude-args.txt'));
  assert.ok(asked, 'claude was started after the clone');
  assert.match(asked[1], /Apply this change to THIS clone only, using ddev drush \/ ddev composer via Bash where needed: Rename it x \$\(touch .*-dollar\) `touch .*-tick` \$HOME 'q'$/);
  nothingRan();
});

test('the label of a new command and the summary of a proposal reach the commands tool as typed', async () => {
  const label = `My tool ${hostile('label')}`;
  let r = await post('/actions/command-new', { target: 'dev', newName: 'cmd-tools-quoting.sh', label, purpose: 'print hello' });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'commands', 'args.txt')), ['--new', 'cmd-tools-quoting.sh', '--workspace', 'dev', '--label', label]);
  const summary = `What it is for ${hostile('summary')}`;
  r = await post('/actions/command-propose', { file: 'cmd-tools-anything.sh', summary });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'commands', 'args.txt')), ['--propose', 'cmd-tools-anything.sh', '--summary', summary]);
  nothingRan();
});

test('the purpose, summary and description of an AI item reach the tool and claude as typed', async () => {
  const purpose = `For reviews ${hostile('purpose')}`;
  let r = await post('/actions/clone-item', { workspace: 'ai-agents', name: 'one-agent', cloneTo: 'two-agent', purpose });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'ai-agents', 'args.txt')), ['one-agent', '--clone-to', 'two-agent', '--purpose', purpose]);
  const summary = `Shared ${hostile('isummary')}`;
  r = await post('/actions/propose-item', { workspace: 'ai-agents', name: 'one-agent', summary });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'ai-agents', 'args.txt')), ['one-agent', '--propose', '--summary', summary]);
  const description = `Checks links ${hostile('describe')}`;
  r = await post('/actions/generate-item', { workspace: 'ai-agents', name: 'three-agent', description });
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(fs.readFileSync(path.join(root, 'claude-args.txt'), 'utf8').includes(`What it should do: ${description}\n`), 'the description is in the prompt as typed');
  nothingRan();
});

test('Add the test users: the profile is read from the project and quoted, and a folder name that is not a name is refused', async () => {
  let r = await post('/actions/add-users', { workspace: 'dev', projectName: 'site1' });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(lines(path.join(root, 'dev', 'users-args.txt')), ['site1', 'webship']);
  const contrib = path.join(root, 'dev', 'site1', 'web', 'profiles', 'contrib');
  fs.rmSync(path.join(contrib, 'webship'), { recursive: true });
  // No slash can be in a folder name: the command finds ran/ from the workspace folder it runs in.
  fs.mkdirSync(path.join(contrib, 'x$(cd ..;cd ran;touch add-users-dollar)'));
  fs.rmSync(path.join(root, 'dev', 'users-args.txt'));
  r = await post('/actions/add-users', { workspace: 'dev', projectName: 'site1' });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /profile folder is not a plain name/);
  assert.ok(!fs.existsSync(path.join(root, 'dev', 'users-args.txt')), 'nothing was started');
  nothingRan();
});
