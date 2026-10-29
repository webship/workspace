#!/usr/bin/env bash

# Keep whole workspace folders on a second disk: storage.second in settings.yml.
# A moved workspace is a symlink, <root>/<name> -> <storage>/<name>, so nothing else changes.
#
#   bash core/scripts/storage.sh                      status (the default)
#   bash core/scripts/storage.sh --move videos        copy, verify, swap to a symlink
#   bash core/scripts/storage.sh --remove-pre-move videos
#   bash core/scripts/storage.sh --back videos        the reverse
#   bash core/scripts/storage.sh --mounts             the dashboard container's mounts
#   bash core/scripts/storage.sh --relink --mounts    after the drive got a new mount point

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;


ARGPARSE_DESCRIPTION="Keep workspace folders on a second disk (storage.second in settings.yml)"
source ${WORKSPACE_SCRIPTS}/args/arg-storage.sh || exit 1 ;

shift $#;

status=0 ;
[ -n "${MOVE}" ] && { storage_move "${MOVE}" || exit 1 ; } ;
[ -n "${BACK}" ] && { storage_back "${BACK}" || exit 1 ; } ;
[ -n "${REMOVE_PRE_MOVE}" ] && { storage_remove_pre_move "${REMOVE_PRE_MOVE}" || status=1 ; } ;
[ "${RELINK}" == 'yes' ] && { storage_relink || status=1 ; } ;
# A move or a relink changes what the dashboard has to mount, so --mounts runs last.
if [ "${MOUNTS}" == 'yes' ] && [ "${DRY_RUN}" != 'yes' ] ; then
  storage_write_mounts || status=1 ;
elif [ -n "${MOVE}${BACK}" ] && [ "${DRY_RUN}" != 'yes' ] && [ "$(storage_compose)" != "$(cat "$(storage_compose_file)" 2>/dev/null)" ] ; then
  echo "" ;
  echo "  ! The dashboard's mounts no longer match. Run: bash ${WORKSPACE_SCRIPTS}/storage.sh --mounts" ;
fi
if [ "${STATUS}" == 'yes' ] || [ -z "${MOVE}${BACK}${REMOVE_PRE_MOVE}${RELINK}${MOUNTS}" ] ; then
  storage_status ;
fi
exit ${status} ;
