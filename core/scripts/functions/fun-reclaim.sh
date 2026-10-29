#!/usr/bin/env bash

# Reclaim the disk that removed projects left behind.
#
# Deleting a project directory does not delete its Docker footprint. DDEV keeps the database in a
# named volume, the built web and db images per project, a snapshots volume, and the container — and
# none of it goes when the folder does. On a machine that builds and throws away sites all day that
# accumulates into tens of gigabytes of data belonging to projects that no longer exist.
#
# THE ONE RULE THIS COMMAND IS BUILT AROUND: if a project's folder is still on disk, nothing
# belonging to it is touched. Not its database, not its snapshots, not its images — even when the
# project is stopped, even when the volume is attached to nothing. A stopped project is a project you
# are coming back to.
#
# That rule is why this never uses `docker volume prune` or `docker image prune -a`. Those decide by
# "is anything using it right now", which on this machine is the wrong question: 23 of the 30
# unattached volumes here belong to projects whose folders are present, so a prune would delete 23
# live databases. Every removal below is by explicit name, after the folder check.
#
# Two more guards on top of it:
#   * dry run by default — `--apply` is the arming step, because every action here is a deletion;
#   * an age floor (`--keep-days`, default 7) — a project you deleted an hour ago may be one you
#     want back this afternoon.
#
# DDEV name normalisation matters and is easy to get wrong: DDEV replaces `_` with `-` in the
# resources it creates, so the project `v11x00b1figma2drupalai_claude_agent_sdk` owns the volume
# `v11x00b1figma2drupalai-claude-agent-sdk-mariadb`. Matching the raw directory name alone reports a
# live project as gone and offers to delete its database. Both spellings go into the protected set.

# Every project name that must never be touched, one per line:
#   * every directory anywhere under the workspace tree that carries a .ddev/ — at any depth, since
#     projects live at <workspace>/<project> and sometimes deeper;
#   * both the raw name and the DDEV-normalised one;
#   * every name DDEV still has in its own registry, whatever its status.
function reclaim_protected_names() {
  {
    find "${WORKSPACE_ROOT}" -mindepth 2 -maxdepth 5 -name '.ddev' -type d -prune 2>/dev/null \
      | sed 's|/\.ddev$||' \
      | while read -r p ; do b="$(basename "$p")" ; printf '%s\n%s\n' "$b" "$(printf '%s' "$b" | tr '_' '-')" ; done
    ddev list --json-output 2>/dev/null | jq -r '.raw[]?.name // empty' 2>/dev/null
    # The shared infrastructure is not a project and has no folder to find. It is what makes every
    # build fast; deleting it is a self-inflicted hour of re-downloading.
    printf 'ddev-global-cache\nddev-ssh-agent\n'
  } | sed '/^$/d' | sort -u ;
}

# Is this resource owned by a protected project? Conservative on purpose: it strips the pieces DDEV
# appends, then also accepts a protected name as a PREFIX, so a compose-created volume like
# `penpot_penpot_assets` is protected by the project `penpot`. When in doubt this answers "yes".
function reclaim_is_protected() {
  local resource="$1" protected_file="$2" stem ;
  # Delimiter is # rather than | : the alternation below IS a |, and sed would read the first one as
  # the end of the s command.
  stem="$(printf '%s' "${resource}" \
    | sed -E 's#^ddev-##; s#-(snapshots|mariadb|postgres|mysql|solr|elasticsearch|redis)$##; s#:.*$##')" ;
  grep -qxF "${stem}" "${protected_file}" && return 0 ;
  # `local pname`, not `name`: this loop runs INSIDE the caller's own `while read -r name` loops, and
  # an unlocalised `name` here overwrites theirs — which printed every container with a blank name.
  #
  # Underscore only, never hyphen. docker-compose prefixes its volumes with the project and an
  # underscore (`penpot` owns `penpot_penpot_assets`), so that one has to be honoured. A hyphen
  # prefix must NOT be: DDEV project names share prefixes, so `website_starter` would protect
  # `website_starter-committed-0726-mariadb` — a different, genuinely dead project. The suffix strip above
  # already handles `<project>-mariadb` and `ddev-<project>-snapshots` by exact match.
  local pname ;
  while read -r pname ; do
    [ -z "${pname}" ] && continue ;
    case "${resource#ddev-}" in
      "${pname}"|"${pname}"_*) return 0 ;;
    esac
  done < "${protected_file}" ;
  return 1 ;
}

# Docker reports sizes as human strings ("337.6MB"); this turns one into bytes so the report can add
# them up. Unknown or empty reads as 0 rather than failing the sweep.
function reclaim_to_bytes() {
  printf '%s' "${1:-0}" | awk '
    /[0-9]/ {
      v = $0 ; sub(/[A-Za-z]+$/, "", v) ; u = $0 ; sub(/^[0-9.]+/, "", u) ;
      m = 1 ;
      if (u ~ /^kB?$/) m = 1000 ; else if (u ~ /^MB?$/) m = 1000000 ;
      else if (u ~ /^GB?$/) m = 1000000000 ; else if (u ~ /^TB?$/) m = 1000000000000 ;
      printf "%d", v * m ; exit
    }
    { print 0 }' ;
}

function reclaim_human() {
  awk -v b="${1:-0}" 'BEGIN { s="B KB MB GB TB"; split(s,u," "); i=1;
    while (b >= 1000 && i < 5) { b /= 1000; i++ } printf "%.1f %s", b, u[i] }' ;
}

# A project DDEV still knows about, whose directory is gone: let DDEV remove it.
#
# `ddev delete --omit-snapshot --yes <name>` is the complete operation and raw docker calls are not —
# it drops the registry entry in ~/.ddev/project_list.yaml, the containers, the database and snapshot
# volumes, the router configuration and the hosts entries, in the right order. Removing the volume by
# hand leaves the registry entry behind, which is what makes `ddev list` accumulate rows reading
# "project directory missing" that outlive anyone's memory of what they were.
#
# --omit-snapshot on purpose: the folder is already gone, so there is no codebase for a parting
# database dump to belong to, and writing one would be reclaiming disk by spending it.
#
# This runs BEFORE the docker passes, so whatever DDEV handles here is simply not found by them.
function reclaim_ddev_orphans() {
  local apply="$1" ;
  local list="${HOME}/.ddev/project_list.yaml" ;
  local name="" approot found=0 ;

  echo "→ DDEV projects still registered whose directory is gone" ;
  [ -f "${list}" ] || { echo "   (no ${list} — DDEV has no registry here)" ; echo "" ; return 0 ; }

  # The registry file rather than `ddev list`: a row whose approot has vanished is exactly what is
  # being looked for, and `ddev list` is slower and can refuse outright on a broken entry.
  while IFS= read -r line ; do
    case "${line}" in
      [a-zA-Z0-9]*:) name="${line%:}" ;;
      *approot:*)
        approot="$(printf '%s' "${line}" | sed -E 's/.*approot:[[:space:]]*//')" ;
        [ -z "${name}" ] && continue ;
        [ -d "${approot}" ] && continue ;
        found=$(( found + 1 )) ;
        printf "   %-42s %s\n" "${name}" "${approot} (gone)" ;
        if [ "${apply}" == 'yes' ] ; then
          ddev delete --omit-snapshot --yes "${name}" > /dev/null 2>&1 \
            && echo "     removed with ddev delete — registry, containers and volumes together" \
            || echo "     ddev delete refused; the docker passes below will catch what is left" ;
        fi
        ;;
    esac
  done < "${list}" ;

  [ "${found}" -eq 0 ] && echo "   none — every registered project still has its directory" ;
  echo "" ;
}

function reclaim_command() {
  local apply="${APPLY}" cats="${ONLY}" keep_days="${KEEP_DAYS}" ;
  local protected freed=0 ;

  command -v docker > /dev/null 2>&1 || { echo "docker is not on PATH — nothing to sweep." ; return 1 ; }

  protected="$(mktemp)" ; trap 'rm -f "${protected}"' RETURN ;
  reclaim_protected_names > "${protected}" ;

  if [ "${LIST_PROTECTED}" == 'yes' ] ; then
    echo "" ;
    echo "Protected — nothing belonging to any of these can be removed:" ;
    nl -ba "${protected}" | sed 's/^/   /' ;
    echo "" ;
    echo "   $(wc -l < "${protected}") names, from the folders under ${WORKSPACE_ROOT} and DDEV's own registry." ;
    echo "" ;
    return 0 ;
  fi

  [ "${cats}" == '_none_' ] && cats="cache,volumes,images,containers" ;
  local want_cache=0 want_vol=0 want_img=0 want_con=0 ;
  case ",${cats}," in *,cache,*)      want_cache=1 ;; esac ;
  case ",${cats}," in *,volumes,*)    want_vol=1 ;; esac ;
  case ",${cats}," in *,images,*)     want_img=1 ;; esac ;
  case ",${cats}," in *,containers,*) want_con=1 ;; esac ;

  echo "" ;
  echo "── Reclaim ──────────────────────────────────────────────────────────" ;
  df -h / | awk 'NR==2 {printf "   disk: %s used of %s (%s), %s free\n", $3, $2, $5, $4}' ;
  echo "   protecting $(wc -l < "${protected}") project name(s); anything with a folder is off limits" ;
  echo "   age floor: nothing younger than ${keep_days} day(s)" ;
  [ "${apply}" == 'yes' ] && echo "   MODE: applying — things will be deleted" \
                          || echo "   MODE: dry run — nothing will be deleted (add --apply)" ;
  echo "" ;

  # ---- DDEV first: it removes a registered project completely; docker cannot ----
  reclaim_ddev_orphans "${apply}" ;

  # ---- containers: exited, and not owned by a protected project -----------------
  if [ "${want_con}" -eq 1 ] ; then
    echo "→ exited containers" ;
    # Ownership comes from DDEV's own label, not from the container name. Guessing the project out of
    # `ddev-milvus-milvus-standalone` by stripping a service suffix cannot work — milvus names its
    # services `milvus-standalone` and `milvus-attu` — and getting it wrong offers a live project's
    # container for removal. `com.ddev.site-name` is the answer DDEV itself uses. Containers that
    # carry no such label are not DDEV's, and fall back to the name check.
    while IFS=$'\t' read -r name size labels ; do
      [ -z "${name}" ] && continue ;
      # `.Labels` is a comma-joined STRING in docker ps --format, not a map, so `index` errors on it;
      # the value is pulled out of the string. It is empty on non-DDEV containers.
      local owner ; owner="$(printf '%s' "${labels}" | sed -n 's/.*com\.ddev\.site-name=\([^,]*\).*/\1/p')" ;
      if [ -n "${owner}" ] && grep -qxF "${owner}" "${protected}" ; then continue ; fi
      if reclaim_is_protected "${name#ddev-}" "${protected}" ; then continue ; fi
      printf "   %-52s %s\n" "${name}" "${size}" ;
      freed=$(( freed + $(reclaim_to_bytes "${size%% *}") )) ;
      [ "${apply}" == 'yes' ] && docker rm "${name}" > /dev/null 2>&1 ;
    done < <(docker ps -a --filter status=exited \
      --format '{{.Names}}\t{{.Size}}\t{{.Labels}}' 2>/dev/null) ;
    echo "" ;
  fi

  # ---- volumes: attached to nothing, no folder, no registry entry ---------------
  if [ "${want_vol}" -eq 1 ] ; then
    echo "→ volumes of projects that no longer exist" ;
    local attached ; attached="$(mktemp)" ;
    docker ps -aq 2>/dev/null | xargs -r docker inspect --format \
      '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' 2>/dev/null \
      | sed '/^$/d' | sort -u > "${attached}" ;
    while read -r vol ; do
      [ -z "${vol}" ] && continue ;
      grep -qxF "${vol}" "${attached}" && continue ;              # in use by a container
      reclaim_is_protected "${vol}" "${protected}" && continue ;   # its project still exists
      local size ; size="$(docker system df -v 2>/dev/null | awk -v v="${vol}" '$1==v {print $3; exit}')" ;
      printf "   %-52s %s\n" "${vol}" "${size:-?}" ;
      freed=$(( freed + $(reclaim_to_bytes "${size}") )) ;
      [ "${apply}" == 'yes' ] && docker volume rm "${vol}" > /dev/null 2>&1 ;
    done < <(docker volume ls -q 2>/dev/null) ;
    rm -f "${attached}" ;
    echo "" ;
  fi

  # ---- images: DDEV's per-project built images, for projects that are gone ------
  if [ "${want_img}" -eq 1 ] ; then
    echo "→ per-project DDEV images of projects that no longer exist" ;
    while IFS=$'\t' read -r img size ; do
      [ -z "${img}" ] && continue ;
      # ddev/ddev-webserver:v1.25.2-<project>-built  →  <project>
      local proj ; proj="$(printf '%s' "${img}" | sed -E 's#^.*:v[0-9]+\.[0-9]+\.[0-9]+-##; s#-built$##')" ;
      [ "${proj}" == "${img}" ] && continue ;                     # not a per-project image
      reclaim_is_protected "${proj}" "${protected}" && continue ;
      printf "   %-58s %s\n" "${img}" "${size}" ;
      freed=$(( freed + $(reclaim_to_bytes "${size}") )) ;
      [ "${apply}" == 'yes' ] && docker rmi "${img}" > /dev/null 2>&1 ;
    done < <(docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' 2>/dev/null | grep -E ':v[0-9.]+-.*-built') ;
    echo "" ;
  fi

  # ---- images left behind by a DDEV UPGRADE ------------------------------------
  # A different question from the one above, and a bigger answer. These belong to projects that are
  # perfectly alive; what is dead is the DDEV version they were built for. `ddev start` rebuilds
  # against the installed version and never looks at the old tag again, so every
  # ddev/*:v<old>-<project>-built and every ddev/*:v<old> base image is weight that will not be used
  # — 12 images and about 10 GB on this machine after one upgrade.
  #
  # The installed version is read from ddev itself rather than assumed. A container still running on
  # an old image holds it, and `docker rmi` refuses in that case: that refusal is the safety net, not
  # an error, so it is reported quietly rather than treated as a failure.
  if [ "${want_img}" -eq 1 ] ; then
    local ddev_version ;
    ddev_version="$(ddev --version 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1)";
    echo "→ DDEV images from a superseded version (installed: ${ddev_version:-unknown})" ;
    if [ -z "${ddev_version}" ] ; then
      echo "   could not read the DDEV version — skipped rather than guessing" ;
    else
      local held=0 ;
      while IFS=$'\t' read -r img size ; do
        [ -z "${img}" ] && continue ;
        case "${img}" in *:"${ddev_version}"|*:"${ddev_version}"-*) continue ;; esac ;
        printf "   %-62s %s\n" "${img}" "${size}" ;
        freed=$(( freed + $(reclaim_to_bytes "${size}") )) ;
        if [ "${apply}" == 'yes' ] ; then
          docker rmi "${img}" > /dev/null 2>&1 || { held=$(( held + 1 )) ; } ;
        fi
      done < <(docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' 2>/dev/null \
                 | grep -E '^ddev/[^:]*:v[0-9]+\.[0-9]+\.[0-9]+') ;
      [ "${held}" -gt 0 ] && echo "   ${held} still held by a container — they go on its next ddev start" ;
    fi
    echo "" ;
  fi

  # ---- build cache: belongs to no project at all -------------------------------
  # Last, and reported separately: it is not project data, it is Docker's layer cache. Removing it
  # costs one slower rebuild and nothing else, which usually makes it the largest safe win.
  if [ "${want_cache}" -eq 1 ] ; then
    echo "→ Docker build cache older than ${keep_days} day(s)" ;
    docker system df 2>/dev/null | awk '/^Build Cache/ {printf "   total %s, reclaimable %s\n", $5, $6}' ;
    if [ "${apply}" == 'yes' ] ; then
      if docker buildx version > /dev/null 2>&1 ; then
        docker buildx prune --force --filter "until=$(( keep_days * 24 ))h" 2>/dev/null | tail -2 ;
      else
        docker builder prune --force --filter "until=$(( keep_days * 24 ))h" 2>/dev/null | tail -2 ;
      fi
    else
      echo "   (dry run — add --apply to prune it)" ;
    fi
    echo "" ;
  fi

  echo "── Summary ──────────────────────────────────────────────────────────" ;
  if [ "${apply}" == 'yes' ] ; then
    echo "   reclaimed about $(reclaim_human "${freed}") from named resources, plus any build cache above." ;
    df -h / | awk 'NR==2 {printf "   disk now: %s used of %s (%s), %s free\n", $3, $2, $5, $4}' ;
  else
    echo "   would reclaim about $(reclaim_human "${freed}") from named resources, plus the build cache above." ;
    echo "   Nothing was deleted. Re-run with --apply to do it:" ;
    echo "     bash cmd-tools-reclaim.sh --apply" ;
  fi
  echo "   Anything with a folder under ${WORKSPACE_ROOT} was left alone. See --list-protected." ;
  echo "" ;
}
