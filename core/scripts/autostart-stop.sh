#!/usr/bin/env bash

# Record which projects were running, so `autostart: running` has something to restore.
#
# Run as the service's ExecStop, which systemd calls on a clean shutdown or reboot. A hard poweroff
# never runs it, so the file can be stale or absent — the boot side treats that as "dashboard only"
# rather than failing, because a boot that starts nothing is worse than a boot that starts one thing.
#
# It records rather than acts: nothing here stops a project. `ddev poweroff` on shutdown would be
# tidier in theory and is wrong in practice — Docker is already going down around it, and a half-
# stopped project is how a database volume gets corrupted.

WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source "${WORKSPACE_SCRIPTS}/bootstrap.sh" || exit 0 ;

STATE_DIR="${WORKSPACE_PATH}/state";
STATE_FILE="${STATE_DIR}/autostart-was-running";

mkdir -p "${STATE_DIR}" 2>/dev/null ;

running="$(ddev list --json-output 2>/dev/null \
  | jq -r '.raw[]? | select(.status=="running") | .name' 2>/dev/null | paste -sd, -)";

# Only overwrite when the answer is believable. If Docker is already gone the query returns nothing,
# and writing that empty result would erase a perfectly good record from the previous shutdown.
if [ -n "${running}" ] ; then
  printf '%s\n' "${running}" > "${STATE_FILE}" ;
fi

exit 0 ;
