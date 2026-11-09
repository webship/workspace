/**
 * What the dashboard asks git about a folder is answered once per row per render: the worktree
 * answer is memoised for a few seconds and forgotten on demand.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const g = require('../../git-info');

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
