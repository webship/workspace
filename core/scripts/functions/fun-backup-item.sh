#!/usr/bin/env bash

# One backup implementation for every workspace, because what an "item" is
# differs by workspace and that difference used to be silently wrong:
#
#   projects, demos, dev, test, sandboxes,
#   recipes, modules, components, products   an item is a DIRECTORY
#   skills                                   an item is a DIRECTORY (<name>/SKILL.md)
#   agents, prompts, docs, worklogs          an item is a FILE (<name>.md)
#
# Every backup script used to archive `${PROJECT_NAME}` as if it were always a
# directory. On the file workspaces tar therefore failed with "Cannot stat" —
# and still left a ~45 byte archive behind, so `backups/agents/` filled up with
# plausibly-named files that contained nothing. A backup that looks real and is
# empty is worse than no backup at all, so: resolve the name first, and never
# keep an archive that tar did not actually write.

# Resolve what an item name points at, relative to the current workspace folder.
# Echoes the path, or returns 1 when the name matches nothing.
function resolve_workspace_item() {
  local name="$1";
  if [ -e "${name}" ]; then echo "${name}"; return 0 ; fi
  if [ -e "${name}.md" ]; then echo "${name}.md"; return 0 ; fi
  return 1 ;
}

# Archive one workspace item into backups/<workspace>/.
# Sets BACKUP_TIME and BACKUP_ARCHIVE for callers that need to name a sibling
# file (the project workspaces write a database dump next to the tarball).
function backup_workspace_item() {
  local name="$1";
  local target;

  if ! target=$(resolve_workspace_item "${name}") ; then
    echo "Nothing to back up: no '${name}' in $(pwd)." ;
    return 1 ;
  fi

  BACKUP_TIME=$( date '+%Y-%m-%d_%H-%M-%S' );
  BACKUP_ARCHIVE="${backups}/${doc_name}/${doc_name}---${name}--${BACKUP_TIME}.tar.gz";
  mkdir -p "${backups}/${doc_name}" ;

  if ! tar -cvzf "${BACKUP_ARCHIVE}" "${target}" ; then
    rm -f "${BACKUP_ARCHIVE}" ;
    echo "Backup failed for '${target}' — removed the incomplete archive." ;
    return 1 ;
  fi

  echo "Backed up ${target} to ${BACKUP_ARCHIVE}." ;
}
