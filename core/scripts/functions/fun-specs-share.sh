#!/usr/bin/env bash

################################################################################
## Sharing the specs that are worth sharing.
################################################################################
## SPDD's own claim is that "successful patterns naturally accumulate into a reusable prompt
## library" and that each iteration "starts from accumulated assets". Accumulation does not happen
## by itself: a template improved on one machine, in one workspace, improves nothing for anybody
## else. Agents, skills and prompts already solve this — one shared repository, fetched with
## `git archive` from the fetched remote branch, pulled into the workspace folder to read and edit.
## This is the same mechanism for the same reason.
##
## **Only two kinds of spec are shared, and the exclusion is the design.**
##
##   _defaults/   the templates every spec starts from, and the review checklist.
##   */00-constitution.md   the general spec of a product: what it is, who for, what it must
##                          never become. Written once, revised rarely, useful to everyone who
##                          touches that product.
##
## A NUMBERED spec — `001-some-change/` — is about one change, in one tree, at one moment. It is
## the most valuable artifact locally and pure noise shared: nobody else's repository has that
## change, and the analysis it contains was true of a commit they are not on. Sharing those would
## turn the shared repository into a landfill of other people's finished work, and the templates
## nobody could find in it would stop being pulled. So they stay local.
##
## Nothing here pushes. Promotion to the shared repository goes through the issue and MR/PR path
## like every other change, because a template everybody inherits deserves a review.
################################################################################

# What is shared, as a predicate. One place, so the listing, the diff and the pull cannot disagree
# about what "a shared spec" means.
function specs_is_shared_path() {
  local rel="$1";
  case "${rel}" in
    _defaults/*) return 0 ;;
    */00-constitution.md) return 0 ;;
    *) return 1 ;;
  esac
}

function specs_root() { echo "${WORKSPACE_ROOT}/specs"; }

# Where the shared specs live in the shared repository. A top level `specs/`, beside `prompts/` and
# `.claude/`, because a spec is not a thing Claude Code loads — it is a thing people read.
function specs_repo_path() { echo "specs"; }

# The checkout the repository is read from, kept between runs. Gitignored and hidden from the
# workspace listing, the way the AI-items checkout and the commands mirror are.
function specs_checkout() { echo "$(specs_root)/dev-ai-agents"; }

# Every shared spec in this workspace folder, as paths relative to specs/.
function specs_local_shared() {
  local root; root="$(specs_root)";
  [ -d "${root}" ] || return 0 ;
  ( cd "${root}" && find . -name '*.md' -o -name '*.yml' ) 2>/dev/null \
    | sed 's|^\./||' | sort | while read -r rel ; do
      specs_is_shared_path "${rel}" && echo "${rel}" ;
    done
}

# Refresh the checkout and answer with the remote branch to read from. Prints nothing on success
# beyond the one line saying what it did, because this runs inside every other verb.
function specs_fetch_repo() {
  local checkout; checkout="$(specs_checkout)";
  ensure_gh_cli || return 1 ;
  ensure_git_github_auth ;
  if [ -d "${checkout}/.git" ] ; then
    git -C "${checkout}" fetch --quiet origin || return 1 ;
  else
    echo "Cloning ${WEBSHIP_AI_ITEMS_REPO}…" >&2 ;
    git clone --quiet "https://github.com/${WEBSHIP_AI_ITEMS_REPO}.git" "${checkout}" || {
      echo "Could not clone ${WEBSHIP_AI_ITEMS_REPO} — check gh auth and repository access." >&2 ;
      return 1 ;
    }
  fi
  local remote_branch;
  remote_branch=$(git -C "${checkout}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) ;
  echo "${remote_branch:-origin/${WEBSHIP_AI_ITEMS_REF:-main}}" ;
}

# The shared specs as the repository has them, extracted to a temporary directory. Read from the
# FETCHED REMOTE BRANCH with git archive, never from the checkout's working tree: that clone may
# sit on any branch and hold anybody's work in progress.
function specs_remote_tree() {
  local branch="$1" tmp;
  tmp="$(mktemp -d)" || return 1 ;
  # Both halves quiet: with no specs/ in the branch, git archive fails and tar then complains that
  # an empty stream is not an archive. That pair of errors is the NORMAL answer the first time
  # anybody runs this — the shared repository does not carry specs until somebody proposes one —
  # and printing it makes a working command look broken.
  if ! git -C "$(specs_checkout)" archive "${branch}" "$(specs_repo_path)" 2>/dev/null | tar -x -C "${tmp}" 2>/dev/null ; then
    rm -rf "${tmp}" ;
    return 1 ;
  fi
  echo "${tmp}" ;
}

# What the shared repository has.
function specs_list_remote() {
  local branch tmp base;
  branch="$(specs_fetch_repo)" || return 1 ;
  tmp="$(specs_remote_tree "${branch}")" || {
    echo "Nothing at $(specs_repo_path)/ in ${branch} — the shared repository carries no specs yet." ;
    return 0 ;
  }
  base="${tmp}/$(specs_repo_path)";
  echo "";
  echo "Shared specs in ${WEBSHIP_AI_ITEMS_REPO} (${branch#origin/})";
  echo "";
  ( cd "${base}" && find . -type f \( -name '*.md' -o -name '*.yml' \) | sed 's|^\./||' | sort ) \
    | while read -r rel ; do printf '  %s\n' "${rel}" ; done
  echo "";
  rm -rf "${tmp}" ;
}

# What is here, what is shared, and where the two differ. The answer people actually want, and the
# one that decides whether to pull.
function specs_status() {
  local branch tmp base root rel local_file state;
  root="$(specs_root)";
  echo "";
  echo "Shared specs — ${root}";
  echo "";
  branch="$(specs_fetch_repo)" || { echo "  (the shared repository could not be read; showing local only)" ; branch='' ; }
  if [ -n "${branch}" ] ; then
    tmp="$(specs_remote_tree "${branch}")" || tmp='' ;
    base="${tmp}/$(specs_repo_path)";
  fi

  printf '  %-52s %s\n' "SPEC" "STATE" ;
  specs_local_shared | while read -r rel ; do
    local_file="${root}/${rel}";
    if [ -z "${branch}" ] || [ -z "${tmp}" ] || [ ! -f "${base}/${rel}" ] ; then
      state="local only" ;
    elif cmp -s "${local_file}" "${base}/${rel}" ; then
      state="same as shared" ;
    else
      state="DIFFERS from shared" ;
    fi
    printf '  %-52s %s\n' "${rel}" "${state}" ;
  done

  # And what the repository has that this machine does not — the reason to run --pull.
  if [ -n "${tmp}" ] && [ -d "${base}" ] ; then
    ( cd "${base}" && find . -type f \( -name '*.md' -o -name '*.yml' \) | sed 's|^\./||' | sort ) \
      | while read -r rel ; do
          [ -f "${root}/${rel}" ] || printf '  %-52s %s\n' "${rel}" "in the repository only" ;
        done
  fi
  echo "";
  echo "  --pull to take the shared copy, --diff to see what changed first." ;
  echo "";
  [ -n "${tmp}" ] && rm -rf "${tmp}" ;
  return 0 ;
}

# What would change if this were pulled. Shown before it is taken, never after: a template is read
# by every future spec, and overwriting one unseen is how a local improvement disappears.
function specs_diff() {
  local want="$1" branch tmp base root rel shown=0;
  root="$(specs_root)";
  branch="$(specs_fetch_repo)" || return 1 ;
  tmp="$(specs_remote_tree "${branch}")" || { echo "The shared repository carries no specs yet." ; return 0 ; }
  base="${tmp}/$(specs_repo_path)";

  ( cd "${base}" && find . -type f \( -name '*.md' -o -name '*.yml' \) | sed 's|^\./||' | sort ) \
    | while read -r rel ; do
        [ "${want}" == '_all_' ] || [ -z "${want}" ] || case "${rel}" in *"${want}"*) : ;; *) continue ;; esac
        if [ ! -f "${root}/${rel}" ] ; then
          echo "=== ${rel} — not here yet" ;
        elif ! cmp -s "${root}/${rel}" "${base}/${rel}" ; then
          echo "=== ${rel}" ;
          diff -u "${root}/${rel}" "${base}/${rel}" | sed '1,2d' ;
        fi
      done
  shown=$? ;
  rm -rf "${tmp}" ;
  return 0 ;
}

# Take the shared copy. A local file that differs is BACKED UP first, with the path printed: a pull
# can move you backwards — the shared branch does not carry work still in review — and a template
# somebody improved this morning must not vanish because they ran a sync this afternoon.
function specs_pull() {
  local want="$1" branch tmp base root rel dest backup stamp pulled=0;
  root="$(specs_root)";
  branch="$(specs_fetch_repo)" || return 1 ;
  tmp="$(specs_remote_tree "${branch}")" || { echo "The shared repository carries no specs yet — nothing to pull." ; return 0 ; }
  base="${tmp}/$(specs_repo_path)";
  stamp="$(date +%Y-%m-%d-%H%M)";

  while read -r rel ; do
    [ -n "${rel}" ] || continue ;
    [ "${want}" == '_all_' ] || [ -z "${want}" ] || case "${rel}" in *"${want}"*) : ;; *) continue ;; esac
    specs_is_shared_path "${rel}" || continue ;
    dest="${root}/${rel}";
    if [ -f "${dest}" ] && cmp -s "${dest}" "${base}/${rel}" ; then continue ; fi
    if [ -f "${dest}" ] ; then
      backup="${WORKSPACE_ROOT}/backups/specs/${stamp}/${rel}";
      mkdir -p "$(dirname "${backup}")" ;
      cp "${dest}" "${backup}" ;
      echo "  kept your copy at ${backup}" ;
    fi
    mkdir -p "$(dirname "${dest}")" ;
    cp "${base}/${rel}" "${dest}" ;
    echo "  pulled ${rel}" ;
    pulled=$((pulled + 1)) ;
  done < <( cd "${base}" && find . -type f \( -name '*.md' -o -name '*.yml' \) | sed 's|^\./||' | sort )

  rm -rf "${tmp}" ;
  echo "" ;
  if [ "${pulled}" -eq 0 ] ; then
    echo "Nothing to pull — everything shared is already what you have." ;
  else
    echo "${pulled} file(s) pulled from ${WEBSHIP_AI_ITEMS_REPO}." ;
  fi
}

# Promoting a local improvement back to everybody. Deliberately NOT automated: a template is
# inherited by every future spec in every workspace, so it goes through the same issue-and-PR path
# as any other change. This prints exactly what to do, and creates nothing.
function specs_propose() {
  local root; root="$(specs_root)";
  echo "";
  echo "Sharing a spec back to ${WEBSHIP_AI_ITEMS_REPO}";
  echo "";
  echo "  Nothing here pushes. A template or a constitution is inherited by everyone who pulls it,"
  echo "  so it is proposed and reviewed like any other change:";
  echo "";
  echo "    1. git -C $(specs_checkout) checkout -b <branch>";
  echo "    2. copy your file into $(specs_checkout)/$(specs_repo_path)/<same relative path>";
  echo "    3. commit, push, and open the PR on ${WEBSHIP_AI_ITEMS_REPO}";
  echo "";
  echo "  What is shared: _defaults/ and every 00-constitution.md. A numbered spec is about one";
  echo "  change in one tree and is not shared — see fun-specs-share.sh for why.";
  echo "";
}
