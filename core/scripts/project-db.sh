#!/usr/bin/env bash

# What the dashboard asks of a project's database (webship/workspace#937), in the project's folder:
#
#   cd <project> && bash core/scripts/project-db.sh describe
#
# prints one line of JSON: {"platform": "<name>", "extension": ".dump", "database": true} when a platform's plugin keeps
# the project's database (its hook, functions/fun-project-db.sh), {"platform": null, "extension": ".sql.gz",
# "database": true|false} otherwise, where database says whether DDEV's database (or the runtime's) is there.
#
#   cd <project> && bash core/scripts/project-db.sh restore <backups>/<workspace>---<project>--<stamp>.tar.gz
#
# once the archive is extracted, from the backups list's Restore (#951): starts the project and imports the dump beside
# the archive, through the platform's plugin when one keeps the database, on every runtime (restore_project_db).

WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
project_db_dir="$(pwd)";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh > /dev/null || exit 1 ;
cd "${project_db_dir}" || exit 1 ;

case "${1:-}" in
  describe)
    if ! rt_find_project > /dev/null 2>&1 ; then
      echo '{"platform": null, "extension": ".sql.gz", "database": false}' ;
      exit 0 ;
    fi
    if p="$(rt_db_platform)" ; then
      printf '{"platform": "%s", "extension": "%s", "database": true}\n' "${p}" "$(rt_db_extension "${p}")" ;
    elif rt_has_db ; then
      echo '{"platform": null, "extension": ".sql.gz", "database": true}' ;
    else
      echo '{"platform": null, "extension": ".sql.gz", "database": false}' ;
    fi ;;
  restore)
    if [ -z "${2:-}" ] ; then
      echo "Usage: bash project-db.sh restore <archive>   (in the project's folder, once the archive is extracted)" >&2 ;
      exit 1 ;
    fi
    if ! rt_find_project > /dev/null 2>&1 ; then
      echo "$(basename "${project_db_dir}") is back, but it is not a project of the workspace (no .ddev/config.yaml, and no compose.yaml written by the Webship Workspace): nothing was started or imported." ;
      dump="$(ls "${2%.tar.gz}"-db.* 2> /dev/null | head -1)" ;
      [ -n "${dump}" ] && echo "Its dump is beside the archive: ${dump##*/}." ;
      exit 0 ;
    fi
    restore_project_db "$2" ;;
  *)
    echo "Usage: bash project-db.sh describe|restore <archive>   (in a project folder)" >&2 ;
    exit 1 ;;
esac
