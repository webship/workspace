#!/usr/bin/env bash

################################################################################
## Clone a project into a new name — two shapes, one command.
################################################################################
## THE DEFAULT: a full independent copy. The files are rsynced, the DDEV name is
## rewritten, the database is exported from the source and imported into the
## clone. Nothing is shared, so the two can diverge for ever.
##
## --worktree: a git worktree of the same repository. One .git, one history, one
## fetch — and a working directory per branch, each its own DDEV project with its
## own containers and its own database. This is the shape you want when the two
## copies are two BRANCHES of the same work rather than two different sites: a
## review of somebody's merge request beside your own build, both running, with
## no second clone of a repository whose .git is often larger than the checkout.
##
## Three things about worktrees and DDEV that are not obvious, each of which
## costs a rebuild to discover:
##
##   1. THE DIRECTORY NAMES THE PROJECT. DDEV falls back to the directory name
##      when .ddev/config.yaml carries no `name:` — so a worktree of a project
##      whose config names it inherits that name through git and collides with
##      the source. Removing that one key is what makes every worktree its own
##      project at its own URL. (`ddev config global
##      --omit-project-name-by-default` is the same idea for new projects.)
##   2. THE DATABASE MUST NOT BE SHARED. Two DDEV projects pointed at one
##      database is a corruption waiting for the first `drush updatedb`. Each
##      worktree gets its own, from a dump, exactly as the copying path does.
##   3. GIT DOES NOT CARRY THE BUILD. vendor/, web/core, contrib, the files
##      directory and settings.local.php are git-ignored in every Drupal project
##      template — so a bare worktree is a source tree, not a running site. The
##      git-ignored paths are copied from the source by default, which is both
##      what makes the worktree runnable immediately and precisely the set git
##      has nothing to say about. --no-build-copy opts out for a composer install.
##
## And one footgun, stated because it destroys work: `git worktree remove` will
## delete a worktree that carries commits you have not pushed. Push, or use
## `cmd-tools-remove.sh`, which asks.
##
## What neither path will do: overwrite an existing folder, take a name DDEV
## already knows, modify the source project, or copy a Docker volume directly —
## the database always travels through a dump.
################################################################################

# Is this directory inside a git checkout? True for a normal clone (.git is a
# directory) AND for a worktree (.git is a file pointing at the real one), which
# is the case that matters: a worktree of a worktree is legal and useful.
function project_has_git() {
  local dir="${1:-}"
  [ -n "${dir}" ] || return 1
  git -C "${dir}" rev-parse --git-dir > /dev/null 2>&1
}

# The docroot a project's own .ddev/config.yaml declares, or the empty string.
function project_ddev_docroot() {
  local dir="${1:-}"
  [ -f "${dir}/.ddev/config.yaml" ] || return 0
  sed -n 's/^docroot:[[:space:]]*"\{0,1\}\([^"#]*\)"\{0,1\}[[:space:]]*$/\1/p' \
    "${dir}/.ddev/config.yaml" | head -1 | tr -d '[:space:]'
}

# Drop the `name:` key so the DIRECTORY names the project (see rule 1 above).
# Only a top-level `name:` — a nested one belongs to a service or a hook.
function ddev_config_drop_name() {
  local config="${1:-}"
  [ -f "${config}" ] || return 0
  sed -i '/^name:[[:space:]]/d' "${config}"
}

function clone_project() {
  local source_name="${PROJECT_NAME}";
  local target_name="${TO}";
  local target_ws_dir;

  if [ -z "${target_name}" ] || [ "${target_name}" == '_none_' ] ; then
    echo "Name the clone: --to <name>." ;
    return 1 ;
  fi
  if [ "${TARGET_WORKSPACE}" != '_none_' ] && [ -n "${TARGET_WORKSPACE}" ] ; then
    target_ws_dir="${WORKSPACE_ROOT}/${TARGET_WORKSPACE}" ;
    if [ ! -d "${target_ws_dir}" ] ; then
      echo "No such workspace: ${TARGET_WORKSPACE}" ;
      return 1 ;
    fi
  else
    target_ws_dir="$(pwd)" ;
  fi

  local source_dir="$(pwd)/${source_name}" ;
  local target_dir="${target_ws_dir}/${target_name}" ;

  if [ ! -d "${source_dir}" ] ; then
    echo "No project '${source_name}' in $(pwd)." ;
    return 1 ;
  fi
  if [ -d "${target_dir}" ] ; then
    echo "'${target_dir}' already exists — pick another name or remove it first." ;
    return 1 ;
  fi
  # A name DDEV already tracks belongs to some other project, wherever its folder is.
  if ddev list -j 2>/dev/null | grep -q "\"name\":[[:space:]]*\"${target_name}\"" ; then
    echo "DDEV already has a project named '${target_name}' — pick another name." ;
    return 1 ;
  fi
  # A FOLDER of that name somewhere else in the tree. DDEV would not necessarily
  # object — an unregistered folder is invisible to `ddev list` — but two projects
  # called the same thing in two workspaces is a confusion that only shows up
  # later, when one of them is started and takes the other's address.
  local elsewhere
  elsewhere="$(ls -d "${WORKSPACE_ROOT}"/*/"${target_name}" 2>/dev/null | grep -v "^${target_dir}\$" | head -3)"
  if [ -n "${elsewhere}" ] ; then
    echo "A folder called '${target_name}' already exists in this tree:" ;
    echo "${elsewhere}" | sed 's/^/    /' ;
    echo "Pick another name — two projects of one name in two workspaces collide on" ;
    echo "the same https://${target_name}.ddev.site the moment both are started." ;
    return 1 ;
  fi
  # And the ADDRESS itself may be taken by a project of a different name: an
  # additional hostname is a booking that `ddev list` says nothing about, so a
  # clone named 'blog2-dev' can quietly steal the address blog2 was given.
  local host_owner
  host_owner="$(ddev_hostname_owner "${target_name}" "${target_dir}")"
  if [ -n "${host_owner}" ] ; then
    echo "https://${target_name}.$(ddev_project_tld) is already answered by ${host_owner}." ;
    echo "The clone would take that address from it the next time it starts. Pick" ;
    echo "another name, or free the hostname there first:" ;
    echo "    bash cmd-tools-hostnames.sh <project> --remove ${target_name}" ;
    return 1 ;
  fi

  local as_worktree='no' ;
  if [ "${WORKTREE}" == 'yes' ] ; then
    if ! project_has_git "${source_dir}" ; then
      echo "'${source_name}' is not a git checkout, so there is no repository to add a" ;
      echo "worktree to. Clone it as a copy instead — drop --worktree." ;
      return 1 ;
    fi
    as_worktree='yes' ;
  elif project_has_git "${source_dir}" ; then
    # Offered, not imposed: a copy is still the right answer when the two sites
    # are two different sites rather than two branches of one.
    echo "Note: '${source_name}' is a git checkout, so --worktree can share its" ;
    echo "      history instead of copying the files. Cloning as a full copy." ;
    echo "" ;
  fi

  local is_ddev='no' ;
  [ -f "${source_dir}/.ddev/config.yaml" ] && is_ddev='yes' ;

  local dump='' ;
  if [ "${is_ddev}" == 'yes' ] && [ "${NO_DB}" != 'yes' ] ; then
    echo "Exporting the source database (read-only for '${source_name}')…" ;
    dump="$(mktemp -u /tmp/clone-${source_name}-XXXX).sql.gz" ;
    ( cd "${source_dir}" && ddev start -y >/dev/null 2>&1 ; ddev export-db --file="${dump}" ) || {
      echo "Could not export the source database — is '${source_name}' a healthy DDEV project?" ;
      return 1 ;
    }
  fi

  if [ "${as_worktree}" == 'yes' ] ; then
    clone_project_worktree "${source_dir}" "${target_dir}" "${source_name}" "${target_name}" || return 1 ;
  else
    echo "Copying files to ${target_dir}…" ;
    # Snapshots and DDEV's own transient dirs stay behind; everything else travels.
    rsync -a \
      --exclude='.ddev/db_snapshots' \
      --exclude='.ddev/.downloads' \
      --exclude='.tarballs' \
      "${source_dir}/" "${target_dir}/" ;
    if [ "${is_ddev}" == 'yes' ] ; then
      ( cd "${target_dir}" && echo "Renaming the DDEV project to '${target_name}'…" \
        && ddev config --project-name="${target_name}" ) || return 1 ;
    fi
  fi

  if [ "${is_ddev}" != 'yes' ] ; then
    echo "'${source_name}' is not a DDEV project — files in place, nothing to start." ;
    return 0 ;
  fi

  # Extra addresses, before the start — so the one start that follows is also what
  # publishes them, rather than leaving a hostname that resolves to nothing until
  # somebody restarts. Added, never a rename: the canonical URL is what the rest of
  # the tooling and every printed link uses.
  local extra_hosts=()
  [ "${EXTRA_HOSTNAME}" != '_none_' ] && [ -n "${EXTRA_HOSTNAME}" ] && extra_hosts+=("${EXTRA_HOSTNAME}")
  if [ "${WITH_WORKSPACE_HOSTNAME}" == 'yes' ] ; then
    extra_hosts+=("$(ddev_workspace_hostname "${target_name}" "$(basename "${target_ws_dir}")")") ;
  fi
  if [ "${#extra_hosts[@]}" -gt 0 ] ; then
    echo "Adding the extra address(es)…" ;
    ddev_hostnames_add "${target_dir}" "${extra_hosts[@]}" || return 1 ;
  fi

  cd "${target_dir}" ;
  ddev start -y ;
  if [ -n "${dump}" ] ; then
    echo "Importing the database…" ;
    ddev import-db --file="${dump}" ;
    rm -f "${dump}" ;
  fi

  # What DDEV actually called it. On the worktree path the directory decides, so
  # asking is honest where assuming would be a guess.
  local real_name="$(ddev describe -j 2>/dev/null \
    | sed -n 's/.*"name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)" ;
  [ -n "${real_name}" ] || real_name="${target_name}" ;

  echo "" ;
  echo "*---------------------------------------------------------------------*" ;
  if [ "${as_worktree}" == 'yes' ] ; then
    echo "  ${real_name} is a git worktree of ${source_name}:" ;
    echo "    branch  $(git -C "${target_dir}" rev-parse --abbrev-ref HEAD 2>/dev/null)" ;
    echo "    https://${real_name}.ddev.site" ;
    echo "" ;
    echo "  One .git, one history, its own database. To list them:" ;
    echo "    git -C ${source_dir} worktree list" ;
    echo "  Remove it with cmd-tools-remove.sh, not 'git worktree remove' —" ;
    echo "  that deletes the folder even when it holds unpushed commits." ;
  else
    echo "  ${real_name} is a working clone of ${source_name}:" ;
    echo "    https://${real_name}.ddev.site" ;
  fi
  echo "*---------------------------------------------------------------------*" ;
}

# The worktree half. Kept separate so the copying path is unchanged by it, and so
# a failure here returns before anything is started.
function clone_project_worktree() {
  local source_dir="${1}" target_dir="${2}" source_name="${3}" target_name="${4}" ;
  local branch="${BRANCH}" ;

  [ -n "${branch}" ] && [ "${branch}" != '_none_' ] || branch="${target_name}" ;

  echo "Adding a git worktree at ${target_dir}…" ;
  if git -C "${source_dir}" show-ref --verify --quiet "refs/heads/${branch}" ; then
    # An existing local branch. It cannot already be checked out anywhere else —
    # git refuses that itself, with a clearer message than we could write.
    echo "  branch '${branch}' exists — checking it out in the worktree." ;
    git -C "${source_dir}" worktree add "${target_dir}" "${branch}" || return 1 ;
  elif git -C "${source_dir}" rev-parse --verify --quiet "refs/remotes/origin/${branch}" > /dev/null ; then
    echo "  tracking origin/${branch}." ;
    git -C "${source_dir}" worktree add -b "${branch}" "${target_dir}" "origin/${branch}" || return 1 ;
  else
    echo "  creating branch '${branch}' from $(git -C "${source_dir}" rev-parse --abbrev-ref HEAD)." ;
    git -C "${source_dir}" worktree add -b "${branch}" "${target_dir}" || return 1 ;
  fi

  # Rule 3: git carries the tracked tree and nothing else. The git-ignored paths
  # ARE the build — vendor/, web/core, contrib, the files directory,
  # settings.local.php — and copying exactly that set is what turns a source tree
  # into a running site.
  if [ "${NO_BUILD_COPY}" == 'yes' ] ; then
    echo "  skipping the build copy (--no-build-copy): run 'ddev composer install'" ;
    echo "  in the worktree, and expect no files directory and no settings.local.php." ;
  else
    echo "  copying the git-ignored build from ${source_name}…" ;
    local ignored ;
    ignored="$(mktemp)" ;
    # DDEV's own generated per-project state is git-ignored too, and it is named
    # after the SOURCE — carrying wtsrc.crt into wtcopy makes ddev start warn
    # "unexpected #ddev-generated" on every file and can confuse the router. It is
    # regenerated on start, so it must not travel: only the BUILD does.
    ( cd "${source_dir}" && git ls-files --others --ignored --exclude-standard --directory ) \
      | grep -v -e '^\.ddev/db_snapshots' -e '^\.ddev/\.downloads' -e '^\.ddev/traefik' \
                -e '^\.ddev/\.' -e '^\.tarballs' \
      > "${ignored}" ;
    if [ -s "${ignored}" ] ; then
      rsync -a --files-from="${ignored}" "${source_dir}/" "${target_dir}/" ;
    else
      echo "  nothing git-ignored to copy." ;
    fi
    rm -f "${ignored}" ;
  fi

  # .ddev/ is tracked in some projects and ignored in others; either way the
  # worktree needs it, and by here it has arrived through git or through the copy.
  if [ ! -f "${target_dir}/.ddev/config.yaml" ] ; then
    echo "  .ddev/ is neither tracked nor present — copying it from the source." ;
    rsync -a --exclude='db_snapshots' --exclude='.downloads' --exclude='traefik' \
      --exclude='.*' \
      "${source_dir}/.ddev/" "${target_dir}/.ddev/" ;
  fi

  # Rule 1: let the directory name the project, so this worktree is its own DDEV
  # project at its own URL instead of colliding with the source.
  ddev_config_drop_name "${target_dir}/.ddev/config.yaml" ;
  echo "  DDEV will name it from the directory: ${target_name}" ;
}
