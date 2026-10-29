#!/usr/bin/env bash

################################################################################
## Knowing what a project's folder IS, before anything deletes it.
################################################################################
## Once a project can be cloned as a git worktree (see fun-clone-project.sh) a
## workspace folder holds three different kinds of thing that all look identical
## in `ls`:
##
##   plain     a git checkout that nothing else depends on
##   primary   the checkout that owns the real .git — other folders live off it
##   linked    a worktree; its .git is a FILE pointing at the primary's
##
## The difference matters exactly once, and destructively:
##
##   * Deleting a PRIMARY deletes the shared .git, and every linked worktree of it
##     becomes an orphan — a directory full of files git can no longer say
##     anything about. The branches, the stashes and the reflog go with it. That
##     is unrecoverable in a way that deleting a worktree is not.
##   * Deleting a LINKED worktree is cheap — unless it holds commits that were
##     never pushed, which is the one thing `git worktree remove` will happily
##     destroy for you.
##
## So remove_project asks these questions first and refuses rather than guessing.
## Everything here is read-only except git_worktree_prune, which only tidies
## administrative data git itself calls stale.
################################################################################

# plain | primary | linked | none — what this directory is.
function git_worktree_role() {
  local dir="${1:-}" common toplevel
  [ -n "${dir}" ] && [ -d "${dir}" ] || { echo 'none' ; return 0 ; }
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1 || { echo 'none' ; return 0 ; }

  # In a linked worktree the git dir sits INSIDE the primary's .git as
  # worktrees/<name>, so the two paths differ. In the primary they are the same.
  local gitdir gitcommon
  gitdir="$(git -C "${dir}" rev-parse --absolute-git-dir 2>/dev/null)"
  gitcommon="$(git -C "${dir}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  if [ -n "${gitdir}" ] && [ -n "${gitcommon}" ] && [ "${gitdir}" != "${gitcommon}" ] ; then
    echo 'linked' ; return 0 ;
  fi
  # The primary. Whether it is "primary" or merely "plain" is about whether
  # anything else depends on it.
  if [ -n "$(git_worktree_others "${dir}")" ] ; then
    echo 'primary' ;
  else
    echo 'plain' ;
  fi
}

# The other worktrees of this repository, one absolute path per line, this
# directory excluded. Parsed from the porcelain form, which is stable output
# meant for scripts — `git worktree list` without it aligns columns and would
# break on a path containing spaces.
function git_worktree_others() {
  local dir="${1:-}" self
  [ -n "${dir}" ] && [ -d "${dir}" ] || return 0
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1 || return 0
  self="$(cd "${dir}" && pwd -P)"
  git -C "${dir}" worktree list --porcelain 2>/dev/null \
    | sed -n 's/^worktree //p' \
    | while IFS= read -r p ; do
        [ -n "${p}" ] || continue
        # Compare resolved paths: a symlinked workspace root would otherwise make
        # a folder look like a different one from itself.
        [ "$( (cd "${p}" 2>/dev/null && pwd -P) || echo "${p}")" == "${self}" ] && continue
        echo "${p}" ;
      done
}

# The primary worktree's path — where the real .git lives.
function git_worktree_primary() {
  local dir="${1:-}"
  [ -n "${dir}" ] && [ -d "${dir}" ] || return 0
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1 || return 0
  git -C "${dir}" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p'
}

# The branch checked out here, or '' when detached.
function git_worktree_branch() {
  local dir="${1:-}" b
  b="$(git -C "${dir}" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ "${b}" == 'HEAD' ] && b=''
  echo "${b}"
}

# How many commits reachable from HEAD are on NO remote — i.e. what deleting this
# folder would destroy. Counting against every remote rather than against an
# upstream, because a worktree branch created locally has no upstream at all and
# `@{upstream}` would simply error, which is the case that most needs the answer.
function git_worktree_unpushed() {
  local dir="${1:-}" n
  [ -n "${dir}" ] && [ -d "${dir}" ] || { echo 0 ; return 0 ; }
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1 || { echo 0 ; return 0 ; }
  n="$(git -C "${dir}" rev-list --count HEAD --not --remotes 2>/dev/null)"
  echo "${n:-0}"
}

# Uncommitted work in the folder: tracked changes plus untracked files that are
# not ignored. Unpushed commits are not the only thing a delete throws away.
function git_worktree_dirty() {
  local dir="${1:-}"
  [ -n "${dir}" ] && [ -d "${dir}" ] || { echo 0 ; return 0 ; }
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1 || { echo 0 ; return 0 ; }
  # `grep -c` prints 0 AND exits 1 when nothing matches, so a `|| echo 0` fallback
  # prints a SECOND zero and the caller reads "0 0". Count the lines instead.
  local n
  n="$(git -C "${dir}" status --porcelain --untracked-files=normal 2>/dev/null | wc -l | tr -d '[:space:]')"
  echo "${n:-0}"
}

# After a worktree's directory is gone, its registration in the primary is stale.
# git says so on every `worktree list` until it is pruned, and a new worktree at
# the same path is refused while it stands. Only ever called with the primary.
function git_worktree_prune() {
  local primary="${1:-}"
  [ -n "${primary}" ] && [ -d "${primary}" ] || return 0
  git -C "${primary}" worktree prune 2>/dev/null || true
}

# One human line about a folder, for a listing or a confirmation. Says nothing at
# all for a folder that is not a git checkout, so callers can print it blind.
function git_worktree_summary() {
  local dir="${1:-}" role others n branch unpushed
  role="$(git_worktree_role "${dir}")"
  case "${role}" in
    none) return 0 ;;
    linked)
      branch="$(git_worktree_branch "${dir}")"
      unpushed="$(git_worktree_unpushed "${dir}")"
      printf 'a git worktree on %s of %s' "${branch:-a detached HEAD}" "$(git_worktree_primary "${dir}")" ;
      [ "${unpushed}" -gt 0 ] && printf ' — %s unpushed commit(s)' "${unpushed}" ;
      echo ;;
    primary)
      n="$(git_worktree_others "${dir}" | grep -c .)"
      echo "the main checkout, with ${n} worktree(s) depending on its .git" ;;
    plain)
      branch="$(git_worktree_branch "${dir}")"
      echo "a git checkout on ${branch:-a detached HEAD}" ;;
  esac
}
