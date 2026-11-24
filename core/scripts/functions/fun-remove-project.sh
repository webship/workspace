#!/usr/bin/env bash

# Removing a project has to take DDEV and the filesystem down together, or the
# two drift apart — and the old one-liner let them:
#
#   (cd ${PROJECT_NAME} && ddev delete -y -O 2>/dev/null) ;
#   sudo rm -rf ${PROJECT_NAME}
#
# `2>/dev/null` hid the error and nothing checked the exit code, so when
# `ddev delete` failed the `rm -rf` ran anyway. The directory went, and DDEV kept
# the containers, the database volumes, the snapshots and the registry entry. On
# this machine six removals through the dashboard on 2026-07-28 left ten orphaned
# containers, five *-mariadb volumes, five snapshot volumes and five registry
# entries reading "project directory missing" — which then made the dashboard show
# a bogus status on unrelated projects that happened to share a name.
#
# So: resolve the project the way DDEV does, delete by name (not only by
# directory, which is what fails once a registration is stale), verify the Docker
# side is actually gone, and only then remove the directory. If DDEV cannot be
# cleaned, say so and keep the directory — a half-removed project you can see is
# recoverable; one you cannot is not.

# The DDEV project name for a directory. `name:` is OPTIONAL in config.yaml —
# DDEV omits it when it equals the directory name, so its absence is the common
# case, not a sign this is not a DDEV project.
function ddev_project_name() {
  local dir="$1" name;
  [ -f "${dir}/.ddev/config.yaml" ] || return 1 ;
  name=$(sed -n 's/^name:[[:space:]]*["'"'"']\?\([^"'"'"'[:space:]]\+\).*/\1/p' "${dir}/.ddev/config.yaml" | head -1) ;
  if [ -z "${name}" ]; then
    # DDEV's own default, with the characters it disallows replaced as it does.
    # This fallback used to produce a name with a trailing hyphen, which only ever
    # showed up on the `ddev delete by name` path — and it is the NORM now that a
    # worktree project deliberately carries no name: at all.
    # Not `tr -c`: it complements the NEWLINE too, so 'a-zA-Z0-9._-' turned the
    # trailing newline into a hyphen and "havb2" became "havb2-" — a name no
    # project has. Putting \n in the kept set then makes '_-\n' parse as a RANGE
    # ("range-endpoints in reverse collating sequence order"). Bash's own
    # substitution has neither problem.
    name="$(basename "${dir}")" ;
    name="${name//[^a-zA-Z0-9._-]/-}" ;
  fi
  echo "${name}" ;
}

# What Docker still holds for a project name, one line per object.
function ddev_leftovers() {
  local name="$1";
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -x "ddev-${name}-\(db\|web\)" ;
  docker volume ls --format '{{.Name}}' 2>/dev/null | grep -x "\(${name}-mariadb\|${name}-postgres\|ddev-${name}-snapshots\)" ;
}

# Remove one project: DDEV first, directory second, and never the second without
# the first.
function remove_project() {
  local project="$1";
  local workspace_dir="${WORKSPACE_ROOT}/${doc_name}";

  # Every cmd-tools-remove.sh already calls trim_project_name before calling in, but the trim
  # belongs here too: this is the one function anything destructive goes through, and the caller
  # doing it is not a guarantee the NEXT caller will. "v11x00b1/" is the same project as
  # "v11x00b1", not a name to refuse.
  project="$(trim_project_name "${project}")";

  # A remove is destructive and the name comes from a caller, so validate it
  # rather than interpolating it into `rm -rf`.
  if ! echo "${project}" | grep -qE '^[a-zA-Z0-9_.-]+$' || [ "${project}" == '.' ] || [ "${project}" == '..' ] ; then
    echo "Refusing to remove '${project}': not a plain project name." ;
    return 1 ;
  fi
  if [ ! -d "${workspace_dir}/${project}" ]; then
    echo "No such project: ${workspace_dir}/${project}" ;
    return 1 ;
  fi

  # Before anything is deleted: what IS this folder? Once projects can be cloned
  # as git worktrees, three different things live in a workspace folder and only
  # one of them is safe to delete without asking (see fun-git-worktrees.sh).
  if ! remove_project_worktree_guard "${workspace_dir}/${project}" "${project}" ; then
    return 1 ;
  fi
  # Remembered now, because after the directory is gone git can no longer be asked
  # where its primary was — and the primary is where the stale registration sits.
  local wt_role wt_primary
  wt_role="$(git_worktree_role "${workspace_dir}/${project}")" ;
  wt_primary="$(git_worktree_primary "${workspace_dir}/${project}")" ;

  local name;
  # A project on another runtime (Docker Compose, Podman, Kubernetes: fun-runtime.sh) is taken down there first.
  local found ;
  if [ ! -f "${workspace_dir}/${project}/.ddev/config.yaml" ] && found="$(rt_find_project "${workspace_dir}/${project}")" \
     && [ "${found#* }" == "${workspace_dir}/${project}" ] ; then
    remove_runtime_project "${project}" "${found%% *}" "${wt_role}" "${wt_primary}" ;
    return $? ;
  fi
  if ! name=$(ddev_project_name "${workspace_dir}/${project}") ; then
    echo "${project} has no .ddev/config.yaml — removing the directory only." ;
    remove_project_writable "${workspace_dir}/${project}" ;
    rm -rf "${workspace_dir}/${project}" || return 1 ;
    remove_project_worktree_after "${wt_role}" "${wt_primary}" "${project}" ;
    echo "Removed ${workspace_dir}/${project}" ;
    return 0 ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Removing ${doc_name}/${project}  (DDEV project: ${name})";
  echo "*---------------------------------------------------------------------*";

  # A backup is asked for, never assumed: `--backup` (or the dashboard's
  # checkbox) takes a dump before anything is deleted. Without it a remove is
  # simply a remove — the caller said what they wanted.
  if [ ! "${BACKUP}" == 'yes' ]; then
    echo "  No backup requested — removing without one." ;
  else
  local backup_dir="${WORKSPACE_ROOT}/backups/${doc_name}/${project}";
  local stamp;
  stamp="$(date +%Y-%m-%d-%H%M%S)";
  mkdir -p "${backup_dir}" ;
  echo "  Backing the database up before anything is deleted…" ;
  if ( cd "${workspace_dir}/${project}" && ddev start -y > /dev/null 2>&1 \
       && ddev export-db --file="${backup_dir}/${project}-before-remove-${stamp}.sql.gz" > /dev/null 2>&1 ) ; then
    echo "    ${backup_dir}/${project}-before-remove-${stamp}.sql.gz" ;
  else
    echo "    no database export (the project would not start, or has no database) — continuing." ;
    rmdir "${backup_dir}" 2>/dev/null ;
  fi
  fi

  # In the directory first — that is the registration DDEV trusts most. Errors are
  # shown, not swallowed.
  ( cd "${workspace_dir}/${project}" && ddev delete -y -O ) || {
    echo "  delete in the directory failed — trying by name…" ;
    ddev delete -y -O "${name}" || echo "  delete by name failed too." ;
  }

  # Whatever DDEV did or did not do, check Docker itself.
  local leftovers;
  leftovers=$(ddev_leftovers "${name}") ;
  if [ -n "${leftovers}" ]; then
    echo "  Docker still holds:" ;
    echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Cleaning those up…" ;
    docker ps -a --format '{{.Names}}' 2>/dev/null | grep -x "ddev-${name}-\(db\|web\)" \
      | xargs -r docker rm -f > /dev/null 2>&1 ;
    docker volume ls --format '{{.Name}}' 2>/dev/null \
      | grep -x "\(${name}-mariadb\|${name}-postgres\|ddev-${name}-snapshots\)" \
      | xargs -r docker volume rm -f > /dev/null 2>&1 ;
    leftovers=$(ddev_leftovers "${name}") ;
  fi

  if [ -n "${leftovers}" ]; then
    echo "" ;
    echo "  KEEPING the directory: Docker objects for '${name}' could not be removed:" ;
    echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Deleting the files now would orphan those. Clear them, then re-run." ;
    return 1 ;
  fi

  # Drop the registry entry too, so `ddev list` does not keep describing a project
  # that no longer exists.
  ddev stop --unlist "${name}" > /dev/null 2>&1 || true ;

  rm -rf "${workspace_dir}/${project}" || {
    echo "  Could not remove ${workspace_dir}/${project} — check permissions." ;
    return 1 ;
  }

  remove_project_worktree_after "${wt_role}" "${wt_primary}" "${project}" ;

  echo "  Removed ${workspace_dir}/${project}, its containers, volumes and registry entry." ;
}

# Drupal takes the write bit off sites/default (and settings.php) after an install, and `rm -rf` cannot empty a
# folder it may not write to. Only the owner's write bit, only on folders that lack it, only when asked for a
# folder that is about to be removed.
function remove_project_writable() {
  local dir="$1" ;
  [ -d "${dir}" ] || return 0 ;
  find "${dir}" -xdev -type d ! -perm -u+w -exec chmod u+w {} + 2> /dev/null ;
  return 0 ;
}

# What a runtime still holds for a project, one line per object: containers and volumes of the compose project, or
# the namespace.
function runtime_leftovers() {
  local rt="$1" name="$2" engine ;
  if [ "${rt}" == 'kubernetes' ] ; then
    rt_kubectl get ns "ws-${name}" -o name 2> /dev/null ;
    return 0 ;
  fi
  # Lando names an app's containers and volumes its own way (rt_lando_app): by the folder's label and that name.
  if [ "${rt}" == 'lando' ] ; then
    local app="${name,,}" ; app="${app//[^a-z0-9]/}" ;
    docker ps -a --filter "label=io.lando.root=${3:-}" --format '{{.Names}}' 2> /dev/null ;
    docker volume ls --filter "label=com.docker.compose.project=${app}" --format '{{.Name}}' 2> /dev/null ;
    return 0 ;
  fi
  # Docksal runs compose in the project's .docksal/, under the name rt_docksal_project gives it.
  if [ "${rt}" == 'docksal' ] ; then
    docker ps -a --filter "label=com.docker.compose.project.working_dir=${3:-}/.docksal" --format '{{.Names}}' 2> /dev/null ;
    docker volume ls --filter "label=com.docker.compose.project=$(rt_docksal_project "${3:-}")" --format '{{.Name}}' 2> /dev/null ;
    return 0 ;
  fi
  engine="$(rt_engine "${rt}")" ;
  "${engine}" ps -a --filter "label=com.docker.compose.project=${name}" --format '{{.Names}}' 2> /dev/null ;
  "${engine}" volume ls --filter "label=com.docker.compose.project=${name}" --format '{{.Name}}' 2> /dev/null ;
}

# Remove a project that runs on Docker Compose, Podman, Kubernetes, Lando or Docksal: the runtime first (its containers and its
# database volume, or its namespace), then the image the project was built with, then the directory — and never the
# directory while the runtime still holds something, as for DDEV.
function remove_runtime_project() {
  local project="$1" rt="$2" wt_role="$3" wt_primary="$4" ;
  local workspace_dir="${WORKSPACE_ROOT}/${doc_name}" dir name engine ;
  dir="${workspace_dir}/${project}" ;
  name="$(rt_name "${dir}")" ; name="${name:-${project}}" ;
  engine="$(rt_engine "${rt}")" ;

  echo "*---------------------------------------------------------------------*";
  echo "  Removing ${doc_name}/${project}  (${rt} project: ${name})";
  echo "*---------------------------------------------------------------------*";

  if [ ! "${BACKUP}" == 'yes' ]; then
    echo "  No backup requested — removing without one." ;
  else
    local backup_dir="${WORKSPACE_ROOT}/backups/${doc_name}/${project}" stamp ;
    stamp="$(date +%Y-%m-%d-%H%M%S)";
    mkdir -p "${backup_dir}" ;
    echo "  Backing the database up before anything is deleted…" ;
    if ( cd "${dir}" && ddev start -y > /dev/null 2>&1 \
         && ddev export-db --file="${backup_dir}/${project}-before-remove-${stamp}.sql.gz" > /dev/null 2>&1 ) ; then
      echo "    ${backup_dir}/${project}-before-remove-${stamp}.sql.gz" ;
    else
      echo "    no database export (the project would not start, or has no database) — continuing." ;
      rm -f "${backup_dir}/${project}-before-remove-${stamp}.sql.gz" ; rmdir "${backup_dir}" 2>/dev/null ;
    fi
  fi

  ( cd "${dir}" && ddev delete -y -O ) || echo "  delete on ${rt} failed: its words are above." ;

  local leftovers ;
  leftovers="$(runtime_leftovers "${rt}" "${name}" "${dir}")" ;
  if [ -n "${leftovers}" ] && [ "${rt}" == 'lando' ] ; then
    echo "  docker still holds:" ; echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Cleaning those up…" ;
    local app="${name,,}" ; app="${app//[^a-z0-9]/}" ;
    docker ps -a -q --filter "label=io.lando.root=${dir}" 2> /dev/null | xargs -r docker rm -f > /dev/null 2>&1 ;
    docker volume ls -q --filter "label=com.docker.compose.project=${app}" 2> /dev/null | xargs -r docker volume rm -f > /dev/null 2>&1 ;
    leftovers="$(runtime_leftovers "${rt}" "${name}" "${dir}")" ;
  elif [ -n "${leftovers}" ] && [ "${rt}" == 'docksal' ] ; then
    echo "  docker still holds:" ; echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Cleaning those up…" ;
    docker ps -a -q --filter "label=com.docker.compose.project.working_dir=${dir}/.docksal" 2> /dev/null | xargs -r docker rm -f > /dev/null 2>&1 ;
    docker volume ls -q --filter "label=com.docker.compose.project=$(rt_docksal_project "${dir}")" 2> /dev/null | xargs -r docker volume rm -f > /dev/null 2>&1 ;
    leftovers="$(runtime_leftovers "${rt}" "${name}" "${dir}")" ;
  elif [ -n "${leftovers}" ] && [ "${rt}" != 'kubernetes' ] ; then
    echo "  ${engine} still holds:" ; echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Cleaning those up…" ;
    "${engine}" ps -a --filter "label=com.docker.compose.project=${name}" -q 2> /dev/null | xargs -r "${engine}" rm -f > /dev/null 2>&1 ;
    "${engine}" volume ls --filter "label=com.docker.compose.project=${name}" -q 2> /dev/null | xargs -r "${engine}" volume rm -f > /dev/null 2>&1 ;
    leftovers="$(runtime_leftovers "${rt}" "${name}" "${dir}")" ;
  fi
  if [ -n "${leftovers}" ] ; then
    echo "" ;
    echo "  KEEPING the directory: ${rt} still holds these for '${name}':" ;
    echo "${leftovers}" | sed 's/^/    /' ;
    echo "  Deleting the files now would orphan those. Clear them, then re-run." ;
    return 1 ;
  fi

  # The image the project's web container was built from: nothing else uses it. On a kind cluster it was loaded
  # into the node too. Its name is the one the project's own runtime file says, read before the folder goes: Lando
  # keeps only a-z0-9 of a name and Docksal turns _ into -, so `webship-${name}-web` is only the fallback. The other
  # runtimes' forms are never tried: webship-mysite-web can be another project's.
  local image="" files f ;
  case "${rt}" in
    lando) files=("${dir}/.lando.yml") ;;
    docksal) files=("${dir}/.docksal/docksal.yml") ;;
    kubernetes) files=("${dir}/k8s/stack.yaml" "${dir}/compose.yaml") ;;
    *) files=("${dir}/compose.yaml") ;;
  esac
  for f in "${files[@]}" ; do
    [ -f "${f}" ] && image="$(sed -n "s/^ *image: *[\"']\{0,1\}\(webship-[a-z0-9_.-]*-web\)[\"']\{0,1\} *\$/\1/p" "${f}" | head -1)" ;
    [ -n "${image}" ] && break ;
  done
  image="${image:-webship-${name}-web}" ;
  "${engine}" image rm "${image}" > /dev/null 2>&1 || true ;
  if [ "${rt}" == 'kubernetes' ] ; then
    case "$(rt_kctx)" in kind-*) docker exec "${RT_KIND_CLUSTER}-control-plane" crictl rmi "docker.io/library/${image}:latest" > /dev/null 2>&1 || true ;; esac
  fi

  remove_project_writable "${dir}" ;
  rm -rf "${dir}" || {
    echo "  Could not remove ${dir} — check permissions." ;
    return 1 ;
  }

  remove_project_worktree_after "${wt_role}" "${wt_primary}" "${project}" ;

  if [ "${rt}" == 'kubernetes' ] ; then echo "  Removed ${dir}, its namespace ws-${name} and its image." ;
  elif [ "${rt}" == 'lando' ] ; then echo "  Removed ${dir}, its Lando app (containers and volumes)." ;
  elif [ "${rt}" == 'docksal' ] ; then echo "  Removed ${dir}, its Docksal project (containers and volumes)." ;
  else echo "  Removed ${dir}, its containers, its database volume and its image." ; fi
}

# Refuse a removal that would destroy more than the folder named.
#
# TWO refusals, both requiring --force to override, because both destroy work
# that cannot be got back from the workspace:
#
#   1. THE MAIN CHECKOUT WITH WORKTREES DEPENDING ON IT. Its .git is the only
#      copy of the repository the linked worktrees have; deleting it leaves each
#      of them a pile of files git cannot say anything about — no branch, no
#      history, no reflog. `rm -rf` of the folder gives no warning of any kind,
#      which is precisely why this is checked here rather than left to the user.
#   2. A WORKTREE (or any checkout) HOLDING WORK NOT ON A REMOTE. Unpushed
#      commits and uncommitted changes are what a worktree usually exists FOR, and
#      the clone command hands people worktrees now, so removals of them will be
#      routine. `git worktree remove` refuses a dirty worktree for the same
#      reason; a workspace remove that was more destructive than git's own would
#      be a trap.
#
# Both print exactly what would be lost and how to proceed, because a refusal
# that does not say what to do next just gets forced.
function remove_project_worktree_guard() {
  local dir="${1}" project="${2}" role others n unpushed dirty branch
  role="$(git_worktree_role "${dir}")" ;
  [ "${role}" == 'none' ] && return 0 ;

  if [ "${role}" == 'primary' ] ; then
    others="$(git_worktree_others "${dir}")" ;
    n="$(echo "${others}" | grep -c .)" ;
    if [ "${FORCE:-}" == 'yes' ] ; then
      echo "  ${project} is the main checkout of ${n} worktree(s); --force given, continuing." ;
      echo "  Those folders will keep their files and lose their git repository." ;
    else
      echo "" ;
      echo "*---------------------------------------------------------------------*" ;
      echo "  REFUSING to remove ${project}: it is the MAIN checkout." ;
      echo "*---------------------------------------------------------------------*" ;
      echo "  ${n} worktree(s) live off its .git, and deleting it leaves each of" ;
      echo "  them a folder of files with no repository behind it — no branch, no" ;
      echo "  history, nothing to push:" ;
      echo "" ;
      echo "${others}" | sed 's/^/    /' ;
      echo "" ;
      echo "  Remove those first (each with its own cmd-tools-remove.sh), or pass" ;
      echo "  --force if you have decided to orphan them." ;
      return 1 ;
    fi
  fi

  unpushed="$(git_worktree_unpushed "${dir}")" ;
  dirty="$(git_worktree_dirty "${dir}")" ;
  if [ "${unpushed}" -gt 0 ] || [ "${dirty}" -gt 0 ] ; then
    branch="$(git_worktree_branch "${dir}")" ;
    if [ "${FORCE:-}" == 'yes' ] ; then
      echo "  ${project} holds ${unpushed} unpushed commit(s) and ${dirty} uncommitted change(s); --force given." ;
    else
      echo "" ;
      echo "*---------------------------------------------------------------------*" ;
      echo "  REFUSING to remove ${project}: it holds work that is nowhere else." ;
      echo "*---------------------------------------------------------------------*" ;
      echo "  branch                ${branch:-a detached HEAD}" ;
      echo "  commits on no remote  ${unpushed}" ;
      echo "  uncommitted changes   ${dirty}" ;
      echo "" ;
      if [ "${unpushed}" -gt 0 ] ; then
        git -C "${dir}" log --oneline -5 HEAD --not --remotes 2>/dev/null | sed 's/^/    /' ;
        echo "" ;
      fi
      echo "  Push the branch (git -C ${dir} push -u origin ${branch:-HEAD})," ;
      echo "  or pass --force to delete it anyway." ;
      return 1 ;
    fi
  fi
  return 0 ;
}

# The folder is gone; the primary still has a registration pointing at it, and
# git calls that "prunable" on every worktree list until it is cleared — a new
# worktree at the same path is refused while it stands, which is exactly what
# somebody re-cloning after a mistake will try to do.
function remove_project_worktree_after() {
  local role="${1:-}" primary="${2:-}" project="${3:-}"
  [ "${role}" == 'linked' ] || return 0 ;
  [ -n "${primary}" ] && [ -d "${primary}" ] || return 0 ;
  git_worktree_prune "${primary}" ;
  echo "  Pruned the stale worktree registration in ${primary}." ;
}

# Report DDEV projects and Docker objects with no directory behind them, in this
# workspace, so a drift that already happened is visible instead of silent.
function report_orphans() {
  local workspace_dir="${WORKSPACE_ROOT}/${doc_name}";
  local found=0 name approot;

  echo "*---------------------------------------------------------------------*";
  echo "  DDEV entries with no project directory";
  echo "*---------------------------------------------------------------------*";

  while IFS=$'\t' read -r name approot status ; do
    [ -z "${name}" ] && continue ;
    if [ -n "${approot}" ] && [ ! -d "${approot}" ]; then
      printf "  %-26s %-28s %s\n" "${name}" "${status}" "${approot}" ;
      found=$((found+1)) ;
    fi
  done < <(ddev list --json-output 2>/dev/null \
    | python3 -c "
import json, sys
try:
    for p in json.load(sys.stdin).get('raw') or []:
        print('\t'.join([p.get('name',''), p.get('approot',''), p.get('status','')]))
except Exception:
    pass" 2>/dev/null)

  if [ "${found}" -eq 0 ]; then
    echo "  none" ;
  else
    echo "" ;
    echo "  Clear one with:  ddev stop --unlist <name>" ;
    echo "  Its database volume, if you still want the data, is <name>-mariadb." ;
  fi

  # The registry is per-machine: the dashboard container keeps its own, so an
  # entry stale there is invisible from a host shell and vice versa. Docker is
  # shared by both, so scan it too — that is where a failed remove actually
  # leaves the weight, and it is the same picture from either side.
  echo "" ;
  echo "*---------------------------------------------------------------------*";
  echo "  Docker objects whose ${doc_name}/ directory is gone";
  echo "*---------------------------------------------------------------------*";

  local obj dockerfound=0 pname;
  for obj in $(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^ddev-.*-(db|web)$') ; do
    pname=$(echo "${obj}" | sed -E 's/^ddev-(.*)-(db|web)$/\1/') ;
    [ -d "${workspace_dir}/${pname}" ] && continue ;
    # Only report projects this workspace owns; another workspace's project is
    # not an orphan just because it is not here.
    ls -d "${WORKSPACE_ROOT}"/*/"${pname}" > /dev/null 2>&1 && continue ;
    printf "  container  %-34s %s\n" "${obj}" "$(docker inspect -f '{{.State.Status}}' "${obj}" 2>/dev/null)" ;
    dockerfound=$((dockerfound+1)) ;
  done
  for obj in $(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '(-mariadb|-postgres|^ddev-.*-snapshots)$') ; do
    pname=$(echo "${obj}" | sed -E 's/(-mariadb|-postgres)$//; s/^ddev-(.*)-snapshots$/\1/') ;
    ls -d "${WORKSPACE_ROOT}"/*/"${pname}" > /dev/null 2>&1 && continue ;
    printf "  volume     %s\n" "${obj}" ;
    dockerfound=$((dockerfound+1)) ;
  done

  if [ "${dockerfound}" -eq 0 ]; then
    echo "  none" ;
  else
    echo "" ;
    echo "  These belong to projects that are no longer in any workspace folder." ;
    echo "  A *-mariadb volume still holds that project's database, so read it before" ;
    echo "  deleting if the data matters:" ;
    echo "    docker rm -f <container>      docker volume rm <volume>" ;
  fi
}
