#!/usr/bin/env bash

# Runs every couple of minutes from webship-workspace-watch.timer.
#
# The boot service starts the dashboard once. When Docker itself restarts afterwards (an update, a crash,
# somebody running `systemctl restart docker`), every DDEV container stops and nothing starts them again,
# so every workspace URL answers 404 until a person notices. This notices: it remembers when Docker last
# started, and when that moment has changed it runs the same script the boot service runs, once.
#
# It never starts anything just because the dashboard is not running. A dashboard stopped on purpose
# stays stopped; only "Docker came back since I last looked" restores it.
#
# Overrides, for tests: AUTOSTART_WATCH_STATE (the stamp file), AUTOSTART_WATCH_DOCKER_STAMP (the value
# systemd would report) and AUTOSTART_WATCH_RUN (what to run instead of autostart-run.sh).

WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
STATE="${AUTOSTART_WATCH_STATE:-${XDG_STATE_HOME:-${HOME}/.local/state}/webship-workspace/docker-started}"
RUN="${AUTOSTART_WATCH_RUN:-bash ${WORKSPACE_SCRIPTS}/autostart-run.sh}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" ; }

if [ -n "${AUTOSTART_WATCH_DOCKER_STAMP+x}" ] ; then
  current="${AUTOSTART_WATCH_DOCKER_STAMP}"
else
  [ "$(systemctl is-active docker 2>/dev/null)" = "active" ] || exit 0
  current="$(systemctl show docker --property=ActiveEnterTimestamp --value 2>/dev/null)"
fi
[ -n "${current}" ] || exit 0

mkdir -p "$(dirname "${STATE}")"
previous="$(cat "${STATE}" 2>/dev/null)"

if [ -z "${previous}" ] ; then
  printf '%s\n' "${current}" > "${STATE}"
  log "first look: Docker started ${current}; nothing to do"
  exit 0
fi
[ "${current}" = "${previous}" ] && exit 0

# Record it BEFORE running, so a start that fails is not retried every two minutes.
printf '%s\n' "${current}" > "${STATE}"
log "Docker restarted (${previous} -> ${current}); starting the dashboard again"
bash -c "${RUN}"
