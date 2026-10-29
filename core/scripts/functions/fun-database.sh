#!/usr/bin/env bash

# Each DDEV project gets its own isolated database container, so there is no
# shared host database to drop between rebuilds -- deleting the DDEV project
# (containers + volumes) gives the same clean-slate guarantee.
#
# `ddev delete` only knows about projects DDEV still has in its registry. A project
# whose directory was removed by hand is gone from the registry while its docker
# volumes are still there, and `2>/dev/null || true` hid that. The next build then
# started against a volume provisioned by a DIFFERENT MariaDB version and DDEV
# refused to start at all:
#
#   project website_starter10001 is configured for database mariadb:10.11, but its
#   database volume holds mariadb:11.8
#
# So the volumes are removed by name as well. DDEV names them `<project>-mariadb`
# and `ddev-<project>-snapshots`.
function drop_database() {
  echo "Removing any existing DDEV project for a clean rebuild";
  ddev delete "${PROJECT_NAME}" -y -O 2>/dev/null || true ;

  local volume ;
  for volume in "${PROJECT_NAME}-mariadb" "${PROJECT_NAME}-postgres" "ddev-${PROJECT_NAME}-snapshots" ; do
    if docker volume inspect "${volume}" > /dev/null 2>&1 ; then
      docker volume rm -f "${volume}" > /dev/null 2>&1 \
        && echo "  removed the leftover ${volume} volume" \
        || echo "  could not remove ${volume} — a container may still hold it" ;
    fi
  done
}

# `ddev start` / `ddev restart`, with the one recovery a build actually needs.
#
# DDEV refuses to start when the project's configured database version does not
# match what its database volume already holds, and it is right to: migrating or
# discarding somebody's data is not a decision a tool should take on its own. In a
# BUILD that reasoning does not apply. drop_database has already deleted the
# project and its directory, so any surviving volume belongs to a build that no
# longer exists and there is nothing in it worth keeping.
#
# On that specific failure, and only that one, the volume is thrown away with
# `--reset-database --omit-snapshot`. Every other failure is passed straight
# through, because a build that cannot start for some other reason must fail loudly.
#
# Usage: ddev_up start -y   /   ddev_up restart
function ddev_up() {
  local action="${1:-start}" ; shift || true ;
  local output rc ;

  output="$( ddev "${action}" "$@" 2>&1 )" ; rc=$? ;
  printf '%s\n' "${output}" ;
  [ ${rc} -eq 0 ] && return 0 ;

  if printf '%s' "${output}" | grep -q 'database volume holds' ; then
    echo "" ;
    echo "  The database volume was provisioned by a different MariaDB version." ;
    echo "  This is a fresh build, so the volume is discarded rather than migrated." ;
    ddev start --reset-database --omit-snapshot ;
    return $? ;
  fi

  return ${rc} ;
}
