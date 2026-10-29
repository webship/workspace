#!/usr/bin/env bash

################################################################################
## What version of the Webship Workspace is this machine running?
################################################################################
## One answer, in one place, because three different things install this tree and
## until now only ONE of them left a trace:
##
##   install.sh            a fresh machine          -> stamped nothing
##   sync-tooling.sh --pull  a machine with the clone -> stamped nothing
##   update.sh             a machine on releases    -> wrote .app-version
##
## So `update.sh --check` answered "Installed: (untracked)" and offered an update
## on a tree that was already current, for ever, on every machine that had not been
## updated by the updater. With one person that is a curiosity. Across a team it is
## the support question — "what version are you on?" — that nobody can answer, and
## an update prompt that everyone learns to ignore.
##
## The stamp is a plain file, core/workspace-app/.app-version, holding a tag and
## nothing else. Not git: the live tree is not a checkout (`~/workspace` has no
## .git), which is exactly why `git describe` cannot be the answer.
################################################################################

# Where the stamp lives. WORKSPACE_PATH is core/, set by bootstrap.sh.
function workspace_version_file() {
  echo "${WORKSPACE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/workspace-app/.app-version"
}

# The version this tree reports, or an empty string. Never invents one: a wrong
# version is worse than an absent one, because it stops the question being asked.
function workspace_version() {
  local f
  f="$(workspace_version_file)"
  [ -f "${f}" ] || return 0
  head -1 "${f}" | tr -d '[:space:]'
}

# Record the version this tree is now at. Callers pass what they actually
# installed; nobody guesses.
function workspace_version_stamp() {
  local version="${1:-}"
  local f
  [ -n "${version}" ] || return 1
  f="$(workspace_version_file)"
  mkdir -p "$(dirname "${f}")" 2>/dev/null
  printf '%s\n' "${version}" > "${f}" || return 1
  return 0
}

# The newest release tag, from the repository. Used when a caller knows it is
# installing "whatever is current" rather than a named tag — a fresh install from
# a downloaded ZIP, say. Empty when the network or gh is unavailable, and the
# caller must treat that as "unknown", never as "up to date".
function workspace_latest_tag() {
  local repo="${1:-webship/workspace}" tag=''
  if command -v gh > /dev/null 2>&1 ; then
    tag="$(gh api "repos/${repo}/releases/latest" --jq .tag_name 2>/dev/null)"
  fi
  if [ -z "${tag}" ] && command -v curl > /dev/null 2>&1 ; then
    tag="$(curl -fsSL --max-time 15 "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null \
           | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
  fi
  echo "${tag}"
}

# The version of a git clone of this repository, for sync-tooling.sh --pull: there
# the source IS a checkout, so the tag it is on is the honest answer.
function workspace_clone_version() {
  local clone="${1:-}"
  [ -n "${clone}" ] && [ -d "${clone}/.git" ] || return 0
  git -C "${clone}" describe --tags --abbrev=0 2>/dev/null
}
