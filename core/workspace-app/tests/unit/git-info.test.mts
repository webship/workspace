/**
 * What the dashboard asks git about a folder is answered once per row per render: the worktree
 * answer is memoised for a few seconds and forgotten on demand.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import * as g from '../../git-info.mts';

test('gitWorktreeInfo answers from the memo within the window, and forgets when told', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-info-'));
  execFileSync('git', ['init', '-q', dir]);
  const a = g.gitWorktreeInfo(dir);
  assert.strictEqual(a.role, 'plain');
  assert.strictEqual(a.dirty, 0);
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  assert.strictEqual(g.gitWorktreeInfo(dir).dirty, 0, 'the memo answers within the window');
  assert.strictEqual(g.gitWorktreeInfoNow(dir).dirty, 1, 'the fresh answer sees the change');
  g.gitWorktreeInfoForget(dir);
  assert.strictEqual(g.gitWorktreeInfo(dir).dirty, 1, 'forgotten, it asks git again');
  assert.strictEqual(g.gitWorktreeInfo(path.join(dir, 'nope')).role, 'none');
});

test('in a workspace installed with git clone, a project folder that is not its own repository is no checkout', () => {
  // A workspace that is a git clone of webship/workspace (a contributor's, or the one the plugins' CI checks out):
  // every project folder sits INSIDE that checkout, and git answers there for the enclosing repository. Only the top
  // folder of a checkout (or of a worktree) is one.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-info-ws-'));
  const ws = path.join(tmp, 'workspace');
  const git = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const init = (dir: string) => {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 'T');
  };
  try {
    fs.mkdirSync(path.join(ws, 'dev', 'site'), { recursive: true });
    init(ws);
    fs.writeFileSync(path.join(ws, 'README.md'), 'workspace');
    git(ws, 'add', 'README.md'); git(ws, 'commit', '-qm', 'the workspace');
    const site = path.join(ws, 'dev', 'site');
    fs.writeFileSync(path.join(site, 'index.php'), '<?php');
    const own = path.join(ws, 'dev', 'own');
    fs.mkdirSync(own);
    init(own);
    fs.writeFileSync(path.join(own, 'a'), 'a');
    git(own, 'add', '-A'); git(own, 'commit', '-qm', 'its own repository');
    const side = path.join(ws, 'dev', 'own-side');
    git(own, 'worktree', 'add', '-q', '-b', 'side', side);

    assert.strictEqual(g.projectHasGit(site), false);
    const info = g.gitWorktreeInfoNow(site);
    assert.strictEqual(info.role, 'none', 'not "primary", the workspace clone taken for it');
    assert.deepStrictEqual([info.others, info.unpushed, info.dirty], [[], 0, 0]);
    assert.strictEqual(g.projectHasGit(ws), true);
    assert.strictEqual(g.gitWorktreeInfoNow(ws).role, 'plain');
    assert.strictEqual(g.projectHasGit(own), true);
    assert.strictEqual(g.gitWorktreeInfoNow(own).role, 'primary');
    assert.strictEqual(g.projectHasGit(side), true);
    assert.strictEqual(g.gitWorktreeInfoNow(side).role, 'linked');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
