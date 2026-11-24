/**
 * What the dashboard asks git about a folder: whether it is a repository, which worktree role it has,
 * what a remove would destroy, which branch it is on. Used by the clone and remove forms, the IDE
 * caption and the row context, and handed to plugins through api.lib (the GIT plugin draws its menu
 * from these answers).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** What a folder is to git, and what a remove of it would destroy. */
export interface WorktreeInfo {
  role: 'none' | 'plain' | 'primary' | 'linked';
  branch: string;
  /** The other worktrees of the same repository. */
  others: string[];
  /** The main checkout's path. */
  primary: string;
  unpushed: number;
  dirty: number;
  /** A repository with a branch and no commit yet. */
  unborn?: boolean;
}

/**
 * Is this project directory a git checkout?
 *
 * Asked of git rather than by a test for a `.git` directory, because a project
 * that is ITSELF a worktree carries `.git` as a FILE pointing at the real one —
 * and a worktree of a worktree is both legal and useful. Asking git is the only
 * answer that is right for every shape, including a submodule.
 *
 * The folder must be the TOP of the checkout (`rev-parse --show-toplevel`), not
 * merely inside one: there git answers for the enclosing repository, and in a
 * workspace installed with `git clone` that is the workspace itself, so every
 * project folder that is not its own repository was taken for the workspace's
 * checkout (its remove refused as "the main checkout", a worktree offered of it).
 */
export function projectHasGit(dir: string): boolean {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    const top = r.status === 0 ? String(r.stdout || '').trim() : '';
    return !!top && fs.realpathSync(top) === fs.realpathSync(dir);
  } catch (_) { return false; }
}

/** Does this folder have its own `.git`? A directory for a clone, a file for a worktree. */
export function hasOwnGit(dir: string): boolean {
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
// Memoised for a few seconds per folder: a page of a hundred repositories asks this for every row,
// and the IDE plugin asks again for its caption — five git processes each time. A render reads one
// answer per row; the git actions that change a checkout invalidate it.
let _worktreeMemo = new Map<string, WorktreeInfo>();
let _worktreeMemoAt = 0;
const WORKTREE_TTL_MS = 5000;
export function gitWorktreeInfo(dir: string): WorktreeInfo {
  const now = Date.now();
  if (now - _worktreeMemoAt > WORKTREE_TTL_MS) { _worktreeMemo = new Map(); _worktreeMemoAt = now; }
  const known = _worktreeMemo.get(dir);
  if (known) return known;
  const out = gitWorktreeInfoNow(dir);
  _worktreeMemo.set(dir, out);
  return out;
}
export function gitWorktreeInfoForget(dir?: string): void { if (dir) _worktreeMemo.delete(dir); else _worktreeMemo = new Map(); }

export function gitWorktreeInfoNow(dir: string): WorktreeInfo {
  const out: WorktreeInfo = {
    role: 'none', branch: '', others: [], primary: '', unpushed: 0, dirty: 0,
  };
  if (!projectHasGit(dir)) return out;
  const git = (args: string[]): string => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  };
  const gitdir = git(['rev-parse', '--absolute-git-dir']);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const list = git(['worktree', 'list', '--porcelain'])
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));
  const self = (() => { try { return fs.realpathSync(dir); } catch (_) { return dir; } })();
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
export function gitBranchOf(dir: string): string {
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  } catch (_) { return ''; }
}
