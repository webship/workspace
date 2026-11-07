/**
 * What the dashboard asks git about a folder: whether it is a repository, which worktree role it has,
 * what a remove would destroy, which branch it is on. Used by the clone and remove forms, the IDE
 * caption and the row context, and handed to plugins through api.lib (the GIT plugin draws its menu
 * from these answers).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Is this project directory a git checkout?
 *
 * `rev-parse --git-dir` rather than a test for a `.git` directory, because a
 * project that is ITSELF a worktree carries `.git` as a FILE pointing at the real
 * one — and a worktree of a worktree is both legal and useful. Asking git is the
 * only answer that is right for every shape, including a submodule.
 */
function projectHasGit(dir) {
  try {
    return spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'],
      { stdio: ['ignore', 'ignore', 'ignore'], timeout: 5000 }).status === 0;
  } catch (_) { return false; }
}

/** Does this folder have its own `.git`? A directory for a clone, a file for a worktree. */
function hasOwnGit(dir) {
  try { return fs.existsSync(path.join(dir, '.git')); } catch (_) { return false; }
}

/**
 * What a project folder IS to git: 'none', 'plain', 'primary' (other worktrees
 * live off its .git) or 'linked' (it is a worktree). The destructive difference:
 * deleting a PRIMARY takes the only copy of the repository with it and leaves
 * every linked worktree a folder of files git can say nothing about.
 *
 * Deliberately the same questions fun-git-worktrees.sh asks, so the dashboard and
 * the command cannot disagree about what is safe.
 */
function gitWorktreeInfo(dir) {
  const out = {
    role: 'none', branch: '', others: [], primary: '', unpushed: 0, dirty: 0,
  };
  if (!projectHasGit(dir)) return out;
  const git = (args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  };
  const gitdir = git(['rev-parse', '--absolute-git-dir']);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const list = git(['worktree', 'list', '--porcelain'])
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  const self = fs.realpathSync.native ? (() => { try { return fs.realpathSync(dir); } catch (_) { return dir; } })() : dir;
  out.primary = list[0] || '';
  out.others = list.filter((p) => { try { return fs.realpathSync(p) !== self; } catch (_) { return p !== self; } });
  // A repository with no commits yet has a branch that EXISTS but points at nothing, so
  // `rev-parse --abbrev-ref HEAD` fails and the menus read "detached HEAD" for a folder that was
  // `git init`-ed a moment ago. `symbolic-ref` still names the branch; only when that fails too is
  // HEAD really detached.
  const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const named = git(['symbolic-ref', '--short', '-q', 'HEAD']);
  out.branch = (b && b !== 'HEAD') ? b : named;
  out.unborn = !git(['rev-parse', '--verify', '-q', 'HEAD']) && !!named;
  out.unpushed = parseInt(git(['rev-list', '--count', 'HEAD', '--not', '--remotes']) || '0', 10) || 0;
  out.dirty = git(['status', '--porcelain', '--untracked-files=normal']).split('\n').filter(Boolean).length;
  if (gitdir && common && gitdir !== common) out.role = 'linked';
  else out.role = out.others.length ? 'primary' : 'plain';
  return out;
}

/** The branch a checkout is on, or '' — used only to label the worktree control. */
function gitBranchOf(dir) {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  } catch (_) { return ''; }
}

module.exports = { projectHasGit, hasOwnGit, gitWorktreeInfo, gitBranchOf };
