#!/usr/bin/env bash

# What the boot service runs. Kept as its own file, not inlined into the unit, so that what runs at
# boot is the same thing you can run by hand and read the output of — `core/scripts/autostart.sh --now`
# calls exactly this.
#
# The whole job is: wait until Docker will actually answer, then `ddev start` the configured projects.
# The waiting is the part that matters. At boot this races dockerd, and `ddev start` against a socket
# that is not listening yet fails in a way that leaves the project half-configured — so it polls
# rather than assuming, and gives up loudly instead of silently doing nothing.

# No `set -u`: bootstrap.sh and libs/bash-yaml.sh both read variables that are legitimately unset
# (WORKSPACE_REPO, parse_yaml's optional prefix), so it aborts the chain before Docker is even
# checked. Nothing else in this tree sets it either.

WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source "${WORKSPACE_SCRIPTS}/bootstrap.sh" || exit 1 ;

eval $(parse_yaml "${WORKSPACE_CONFIG}/settings.yml" 2>/dev/null);

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" ; }

# WHICH PROJECTS, and why this is not just a list of names.
#
# A hand-maintained list is wrong within a week: you build a project, you never think about this file
# again, and after the next reboot it is not there. So the setting takes a small vocabulary as well as
# literal names:
#
#   workspace   just the dashboard. The default, and usually the right answer — it boots in seconds
#               and you can start anything else from it with one click.
#   running     whatever was running when the machine last shut down cleanly. This is what people
#               actually mean by "bring my work back", and it needs no maintenance.
#   all         every project DDEV has registered. Honest about the cost: 11 projects here is 11×
#               (web + db) containers competing for RAM and disk at boot.
#   a,b,c       exactly these, in this order.
#
# The dashboard is ALWAYS first and always included, whatever the setting says. It is the way in to
# everything else, so a boot that brings back four sites and no dashboard is a worse outcome than one
# that brings back only the dashboard.
readonly STATE_FILE="${WORKSPACE_PATH}/state/autostart-was-running";

function resolve_projects() {
  local setting="${dashboard_autostart:-workspace}" resolved="";

  case "${setting}" in
    all)
      resolved="$(ddev list --json-output 2>/dev/null | jq -r '.raw[]?.name // empty' 2>/dev/null | paste -sd, -)";
      ;;
    running)
      # Recorded by the service's ExecStop on a clean shutdown. A hard poweroff never runs ExecStop,
      # so the file may be stale or missing — the dashboard-only fallback below covers that rather
      # than the boot failing over a missing file.
      [ -f "${STATE_FILE}" ] && resolved="$(cat "${STATE_FILE}" 2>/dev/null)";
      [ -z "${resolved}" ] && log "no record of what was running (hard poweroff?) — starting the dashboard only" ;
      ;;
    *)
      resolved="${setting}";
      ;;
  esac

  # Dashboard first, then the rest, no duplicates and order preserved.
  printf 'workspace\n%s\n' "$(printf '%s' "${resolved}" | tr ',' '\n')" \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | sed '/^$/d' | awk '!seen[$0]++';
}

# `--list` prints what WOULD start and exits. The status display calls this rather than re-deriving
# the list, so the two can never disagree about what a reboot will bring back — the same reason the
# checks command asks checks_plan.js instead of keeping its own copy of the map.
if [ "${1:-}" == '--list' ] ; then
  resolve_projects ;
  exit 0 ;
fi

# Docker, before anything else. 24 × 5s = two minutes, which covers a cold boot on a slow disk
# without hanging the unit for the full 900s timeout when Docker is genuinely broken.
attempt=0 ;
until docker info > /dev/null 2>&1 ; do
  attempt=$(( attempt + 1 )) ;
  if [ "${attempt}" -ge 24 ] ; then
    log "Docker did not become available after 2 minutes. Nothing was started." ;
    exit 1 ;
  fi
  log "waiting for Docker… (${attempt}/24)" ;
  sleep 5 ;
done
log "Docker is up." ;

# DDEV's own shared infrastructure, before any project. `ddev-router` and `ddev-ssh-agent` are not
# projects — every project depends on them, but nothing owns starting them back up.
#
# This is the actual bug behind "ddev start did not work" and the boot service silently not
# starting the dashboard: a laptop suspend/reboot leaves these containers `exited` (Docker gives
# them no restart policy, same as every project container), and an EXITED container has no live
# network attachment, so Docker's own DNS has nothing to resolve `ddev-router` to. The web
# container's nginx fails at startup with "host not found in upstream ddev-router", supervisord
# gives up after three quick retries, and the WHOLE container exits — cleanly, exit code 0, which
# is why this reads as nothing having failed while nothing comes up either.
#
# `ddev start` does not reliably fix this on its own: it recreates the PROJECT's containers and
# leaves the router exactly as it found it. Confirmed by hand — starting the router first, then
# `ddev start`, works in one try; `ddev start` alone against a dead router does not, however many
# times it is retried.
for infra in ddev-router ddev-ssh-agent ; do
  # Absent entirely is fine — a machine that has never run a project has neither yet, and `ddev
  # start` creates what it needs. Only an EXISTING, stopped container is the failure to repair.
  state="$(docker inspect "${infra}" --format '{{.State.Status}}' 2>/dev/null)" ;
  if [ -n "${state}" ] && [ "${state}" != 'running' ] ; then
    log "${infra} is ${state}, not running — starting it before any project." ;
    docker start "${infra}" > /dev/null 2>&1 ;
    # Give it a moment to attach to the network and pass its own health check before the project
    # that depends on it starts racing it. Not a hard wait: if it is still not running after this,
    # the project start below will fail loudly and say why, rather than hanging silently on it.
    for _ in 1 2 3 4 5 6 ; do
      [ "$(docker inspect "${infra}" --format '{{.State.Status}}' 2>/dev/null)" == 'running' ] && break ;
      sleep 2 ;
    done
  fi
done

projects="$(resolve_projects | paste -sd' ' -)";
log "starting: ${projects}" ;

status=0 ;
for project in ${projects} ; do
  case "${project}" in
    workspace) project_path="${WORKSPACE_PATH}/workspace-app" ;;
    *)         project_path="$(ddev list --json-output 2>/dev/null \
                   | jq -r --arg n "${project}" '.raw[]? | select(.name==$n) | .approot' 2>/dev/null | head -1)" ;;
  esac

  if [ -z "${project_path}" ] || [ ! -d "${project_path}/.ddev" ] ; then
    log "skipping ${project}: no DDEV project found for it." ;
    continue ;
  fi

  log "starting ${project} (${project_path})…" ;
  if ( cd "${project_path}" && ddev start -y ) ; then
    log "started ${project}." ;
  else
    log "FAILED to start ${project}." ;
    status=1 ;
  fi
done

# The screen runner belongs to the same "the machine came back" job. Sessions run on the
# HOST — that is the whole point of them, so `screen -r` works in your own terminal and a
# browser an agent drives opens on your desktop — and the dashboard runs in a container,
# which cannot start a host process. So without this, every Screens page action and every
# item-sync button answers "its runner is not up" until somebody runs one command, on a
# machine that otherwise looks fully set up.
screen_host="${WORKSPACE_PATH}/workspace-app/scripts/screen-host.sh";
if [ -f "${screen_host}" ] ; then
  if bash "${screen_host}" --status 2>/dev/null | grep -q '^Running' ; then
    log "screen runner already up." ;
  elif bash "${screen_host}" --start > /dev/null 2>&1 ; then
    log "started the screen runner." ;
  else
    log "could not start the screen runner — the Screens page will say so." ;
  fi
fi

exit "${status}" ;
