#!/usr/bin/env bash

################################################################################
## Webship Workspace — align the dashboard's docker group with this host
################################################################################
## The dashboard runs in its own DDEV web container with Docker-outside-of-Docker:
## the host's /var/run/docker.sock is bind-mounted in, and that socket is
## root:docker with the HOST's docker GID. The container's web user therefore has
## to share that exact GID, or every `ddev` command inside the dashboard fails:
##
##   Docker error: permission denied while trying to connect to the docker API
##
## which does not look like a permissions problem from the outside. It looks like
## a dashboard where every project is "Stopped" forever, no Start/Stop/Drush item
## ever appears, and pressing Start seems to do nothing — while the project is in
## fact running perfectly well on the host.
##
##   bash core/scripts/docker-gid.sh            align it, if it differs
##   bash core/scripts/docker-gid.sh --check    report, change nothing
##   bash core/scripts/docker-gid.sh --quiet     only speak when something changed
##
## The GID has to be baked at BUILD time, in
## .ddev/web-build/Dockerfile.workspace-app: the container's main process runs as
## uid 1000 (`Config.User=1000:1000`), so no entrypoint script can groupmod its
## way out of it, and supervisord launches the app without calling initgroups() —
## so it must be the web user's PRIMARY group, not a supplementary one.
##
## Which means the value in that file is machine-specific, in a file that
## cmd-tools sync-tooling.sh mirrors wholesale. That is why this exists as a
## script rather than a note in the README: install.sh runs it during setup, and
## sync-tooling.sh runs it after mirroring, so a pull cannot leave the dashboard
## blind to Docker.
################################################################################

set -u

CHECK_ONLY='no'
QUIET='no'
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--check) CHECK_ONLY='yes'; shift ;;
    -q|--quiet) QUIET='yes'; shift ;;
    -h|--help)  sed -n '3,34p' "${BASH_SOURCE[0]}" | sed 's/^## \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKERFILE="${ROOT}/core/workspace-app/.ddev/web-build/Dockerfile.workspace-app"
COMPOSE="${ROOT}/core/workspace-app/.ddev/docker-compose.dood.yaml"

function say()  { [ "${QUIET}" == 'yes' ] || echo "$@" ; }
function warn() { echo "$@" ; }

if [ ! -f "${DOCKERFILE}" ] ; then
  warn "  ✗ No ${DOCKERFILE#${ROOT}/} — nothing to align."
  exit 1
fi

# The socket is the authority when it is there: it is the thing the container has
# to reach. Fall back to the docker group, for a machine where Docker is not up.
host_gid=''
if [ -S /var/run/docker.sock ] ; then
  host_gid="$(stat -c %g /var/run/docker.sock 2>/dev/null)"
fi
if [ -z "${host_gid}" ] ; then
  host_gid="$(getent group docker 2>/dev/null | cut -d: -f3)"
fi
if [ -z "${host_gid}" ] ; then
  warn "  ✗ No docker group and no /var/run/docker.sock — is Docker installed?"
  exit 1
fi

# Both numbers in the file are the same GID: the group, then the web user's primary group.
baked="$(grep -oE 'groupmod -g [0-9]+ docker' "${DOCKERFILE}" | grep -oE '[0-9]+' | head -1)"
if [ -z "${baked}" ] ; then
  warn "  ✗ Could not find the docker GID in ${DOCKERFILE##*/} — has that line changed?"
  exit 1
fi

# The build-time GID makes the group exist in the image; the compose group_add is
# what puts the running process in it. Both have to be right, and they are the same
# number, so they are checked and written together.
granted=""
if [ -f "${COMPOSE}" ] ; then
  granted="$(sed -n '/group_add:/,/^[^ ]/p' "${COMPOSE}" | grep -oE '"[0-9]+"' | tr -d '"' | head -1)"
fi

if [ "${baked}" == "${host_gid}" ] && { [ -z "${granted}" ] || [ "${granted}" == "${host_gid}" ]; } ; then
  say "  ✓ dashboard docker GID ${baked} matches this host"
  exit 0
fi

if [ "${CHECK_ONLY}" == 'yes' ] ; then
  warn "  ✗ dashboard docker GID is ${baked}${granted:+ (granted ${granted})}, this host's docker socket is ${host_gid}"
  warn "    Every ddev command inside the dashboard fails, so every project reads as Stopped."
  warn "    Fix it: bash core/scripts/docker-gid.sh && (cd core/workspace-app && ddev restart)"
  exit 1
fi

# Rewrite both occurrences on that one line, and nothing else in the file.
sed -i -E "s/groupmod -g [0-9]+ docker/groupmod -g ${host_gid} docker/; s/groupadd -g [0-9]+ docker/groupadd -g ${host_gid} docker/; s/usermod -g [0-9]+ \\\$username/usermod -g ${host_gid} \$username/" "${DOCKERFILE}"

# group_add in the compose override: the one the running process actually gets.
if [ -f "${COMPOSE}" ] && [ -n "${granted}" ] ; then
  sed -i -E "/group_add:/,/^[^ ]/ s/\"${granted}\"/\"${host_gid}\"/" "${COMPOSE}"
fi

after="$(grep -oE 'groupmod -g [0-9]+ docker' "${DOCKERFILE}" | grep -oE '[0-9]+' | head -1)"
if [ "${after}" != "${host_gid}" ] ; then
  warn "  ✗ Tried to set the docker GID to ${host_gid} and the file still says ${after}."
  warn "    Edit ${DOCKERFILE#${ROOT}/} by hand — the line is near the end."
  exit 1
fi

warn "  ✓ dashboard docker GID ${baked} → ${host_gid} (this host's docker socket)"
warn "    The image carries the old GID until it is rebuilt:"
warn "      cd ${ROOT}/core/workspace-app && ddev restart"
exit 0
