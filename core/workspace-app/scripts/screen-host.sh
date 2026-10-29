#!/usr/bin/env bash

# The host screen runner for the Webship Workspace dashboard.
#
#   bash core/workspace-app/scripts/screen-host.sh --start    start it in the background
#   bash core/workspace-app/scripts/screen-host.sh --status   is it up, and what is running here
#   bash core/workspace-app/scripts/screen-host.sh --stop      stop it (sessions keep running)
#   bash core/workspace-app/scripts/screen-host.sh --run       run in the foreground
#
# Screen sessions belong on this machine, not inside the dashboard's container:
# the display, the browser an agent drives, ~/.claude and your own terminal are
# all here, so `screen -r <session>` should just work. The dashboard runs in the
# container and cannot start a host process, so it asks this runner instead.
#
# Deliberately SELF-CONTAINED, like scripts/update.sh beside it: plain bash, no
# workspace bootstrap. It runs on the host, before and independently of anything
# the container provides, and it locates the workspace from its own path.

set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${APP_DIR}/../.." && pwd)"
STORE="${ROOT}/.screens"
RUNNER="${APP_DIR}/scripts/screen-runner.js"
PIDFILE="${STORE}/.runner-pid"
LOGFILE="${STORE}/.runner.log"
PORT="${SCREEN_RUNNER_PORT:-7681}"
ACTION=""

while [ $# -gt 0 ]; do
  case "$1" in
    -s|--start)  ACTION=start; shift ;;
    -r|--run)    ACTION=run; shift ;;
    -t|--status) ACTION=status; shift ;;
    -x|--stop)   ACTION=stop; shift ;;
    -p|--port)   PORT="${2:-7681}"; shift 2 ;;
    -h|--help)   sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

mkdir -p "${STORE}"

runner_pid() {
  [ -f "${PIDFILE}" ] || return 1
  local p; p="$(cat "${PIDFILE}" 2>/dev/null)"
  [ -n "${p}" ] && kill -0 "${p}" 2>/dev/null && echo "${p}"
}

case "${ACTION}" in
  stop)
    if p="$(runner_pid)"; then
      kill "${p}" && rm -f "${PIDFILE}"
      echo "Stopped the runner (pid ${p}). The sessions it started keep running."
    else
      echo "The runner is not running."
    fi
    exit 0 ;;
  status)
    if p="$(runner_pid)"; then
      echo "Running — pid ${p}, port $(cat "${STORE}/.runner-port" 2>/dev/null || echo '?')"
    else
      echo "Not running. Start it with: bash ${BASH_SOURCE[0]} --start"
    fi
    echo ""
    echo "Sessions on $(hostname):"
    if command -v screen > /dev/null 2>&1; then
      screen -ls 2>/dev/null | sed -n 's/^\s\+/  /p' || true
    else
      echo "  (screen is not installed here — sudo apt install -y screen)"
    fi
    exit 0 ;;
esac

if ! command -v screen > /dev/null 2>&1; then
  echo "screen is not installed on this machine — the runner would have nothing to drive."
  echo "Install it with:  sudo apt install -y screen    (or: bash ${ROOT}/core/scripts/install.sh)"
  exit 1
fi
if ! command -v node > /dev/null 2>&1; then
  echo "node is not installed on this machine — the runner needs it."
  echo "Install it with:  bash ${ROOT}/core/scripts/install.sh"
  exit 1
fi

if p="$(runner_pid)"; then
  echo "Already running — pid ${p}."
  exit 0
fi

if [ "${ACTION}" = "run" ]; then
  SCREEN_RUNNER_PORT="${PORT}" WORKSPACE_ROOT="${ROOT}" exec node "${RUNNER}"
fi

if [ "${ACTION}" = "start" ]; then
  SCREEN_RUNNER_PORT="${PORT}" WORKSPACE_ROOT="${ROOT}" nohup node "${RUNNER}" >> "${LOGFILE}" 2>&1 &
  echo $! > "${PIDFILE}"
  sleep 1
  if p="$(runner_pid)"; then
    echo "Started the screen runner — pid ${p}, port ${PORT}."
    echo "  log:    ${LOGFILE}"
    echo "  status: bash ${BASH_SOURCE[0]} --status"
    echo ""
    echo "The dashboard now starts sessions HERE, so 'screen -r <session>' works in this terminal"
    echo "and a browser an agent drives opens on your desktop."
  else
    echo "It did not stay up. Its log:"; tail -n 20 "${LOGFILE}"
    exit 1
  fi
  exit 0
fi

echo "Nothing to do: give --start, --run, --status or --stop."
exit 1
