#!/usr/bin/env bash

# A project's database, backed up and put back (webship/workspace#937).
#
# The workspace speaks DDEV's verbs for a database, `ddev export-db` and `ddev import-db`: DDEV serves them on a DDEV
# project, and the runtime layer (fun-runtime.sh) on Docker Compose, Podman and Kubernetes. Some platforms keep their
# database their own way, a service of their own beside DDEV's database or instead of it (Postgres 18 for a FastAPI
# app, MongoDB for Wekan). Their plugin says how to dump it and how to put it back, and every backup and restore of the
# workspace asks it first, on every runtime: the `ddev` function of the runtime layer hands the two verbs to it (so the
# safety dump before a remove, a clone and the row's export get it), and the backup scripts and the row's import use
# export_project_db and import_project_db below.
#
# The hook, in a platform plugin's functions (PLUGINS.md):
#   <platform>_is_project <dir>    is the project in <dir> one of this platform's? (a platform plugin has it already)
#   <platform>_export_db <file>    write the project's database to <file>; run in the project's folder
#   <platform>_import_db <file>    put <file> back as the project's database: it checks the dump is whole first,
#                                  touches nothing when it is not, and says what it replaces
#   <platform>_db_extension        optional: the extension of the platform's own dumps, with its dot (".dump");
#                                  without it the platform's dumps are ".sql.gz"
# A file named *.sql.gz asks for a gzipped SQL dump (what DDEV writes; what the safety dump before a remove and a clone
# ask for); any other name, the platform's own format. The platform's import reads both.
#
# DDEV's import of a database on PostgreSQL goes through rt_ddev_import_db (#968): the database is closed to new
# connections and its sessions ended first, as DDEV drops it, and opened again after.
#
# Without a hook everything is as it was: DDEV's verbs on DDEV, the runtime layer's on the other runtimes. A project with
# no database (DDEV's db omitted, or the runtime's database `none`) and no hook has nothing to back up: its backup says
# so, archives the folder and succeeds.

# The platform whose plugin keeps the database of the project in a folder (here by default): its name, or nothing. A
# platform's plugin keeps it when it declares the three functions of the hook and says the project is one of its own.
function rt_db_platform() {
  local dir="${1:-$PWD}" found root fn p ;
  found="$(rt_find_project "${dir}" 2> /dev/null)" || return 1 ;
  root="${found#* }" ;
  while read -r fn ; do
    p="${fn%_export_db}" ;
    [ -n "${p}" ] || continue ;
    declare -F "${p}_import_db" > /dev/null && declare -F "${p}_is_project" > /dev/null || continue ;
    if "${p}_is_project" "${root}" > /dev/null 2>&1 ; then echo "${p}" ; return 0 ; fi
  done < <(declare -F | awk '{print $3}' | grep '_export_db$' | sort)
  return 1 ;
}

# The extension of a platform's own dumps, with its dot: its plugin's <platform>_db_extension, else ".sql.gz".
function rt_db_extension() {
  local p="$1" ext='' ;
  declare -F "${p}_db_extension" > /dev/null && ext="$("${p}_db_extension")" ;
  [[ "${ext}" =~ ^\.[A-Za-z0-9][A-Za-z0-9.]*$ ]] || ext='.sql.gz' ;
  echo "${ext}" ;
}

# Does the project in a folder (here by default) have a database the workspace keeps: DDEV's, or its runtime's? A DDEV
# project whose configuration omits the db container (omit_containers, in config.yaml or a config.*.yaml) does not; a
# project of another runtime whose database is `none` does not.
function rt_has_db() {
  local found rt root f ;
  found="$(rt_find_project "${1:-$PWD}" 2> /dev/null)" || return 1 ;
  rt="${found%% *}" ; root="${found#* }" ;
  if [ "${rt}" = ddev ] ; then
    for f in "${root}"/.ddev/config.yaml "${root}"/.ddev/config.*.yaml ; do
      [ -f "${f}" ] || continue ;
      awk '
        /^omit_containers:/ { inlist = 1 ; if ($0 ~ /[[,[:space:]]db[],[:space:]]/ || $0 ~ /\[db\]/) found = 1 ; next }
        inlist && /^[[:space:]]*-[[:space:]]*["'\'']?db["'\'']?[[:space:]]*$/ { found = 1 ; next }
        inlist && /^[^[:space:]-]/ { inlist = 0 }
        END { exit found ? 0 : 1 }' "${f}" && return 1 ;
    done
    return 0 ;
  fi
  [ "$(rt_meta database "${root}")" != 'none' ] ;
}

# Back up the database of the project in the current folder to <base> plus the extension of its dump: the platform's
# own dump when its plugin keeps the database, else `ddev export-db` (a gzipped SQL dump, as before). A project with no
# database writes nothing and says so, and that is not a failure. Sets PROJECT_DB_FILE to the file written, or to
# nothing.
function export_project_db() {
  local base="$1" p file ;
  PROJECT_DB_FILE='' ;
  if [ -z "${base}" ] ; then
    echo "export_project_db: where to write the dump (its path, without the extension)." >&2 ;
    return 1 ;
  fi
  if [ -z "${RT_DB_HOOK_ACTIVE:-}" ] && p="$(rt_db_platform)" ; then
    file="${base}$(rt_db_extension "${p}")" ;
    RT_DB_HOOK_ACTIVE=1 "${p}_export_db" "${file}" || { rm -f "${file}" ; return 1 ; } ;
    if [ ! -s "${file}" ] ; then
      echo "The ${p} plugin wrote no dump to ${file}." >&2 ;
      rm -f "${file}" ;
      return 1 ;
    fi
    PROJECT_DB_FILE="${file}" ;
    return 0 ;
  fi
  if ! rt_has_db ; then
    echo "This project has no database to back up: its folder is the whole of it." ;
    return 0 ;
  fi
  file="${base}.sql.gz" ;
  local existed='no' ;
  [ -e "${file}" ] && existed='yes' ;
  if ! ddev export-db --file="${file}" ; then
    # A dump DDEV began and did not finish, empty or cut short, is not left behind for a restore to import (the
    # Import panel lists every .sql.gz); a file that was there before the call is not this call's to remove.
    [ "${existed}" = 'yes' ] || rm -f "${file}" ;
    return 1 ;
  fi
  PROJECT_DB_FILE="${file}" ;
}

# The type of the database of the DDEV project in a folder (here by default), as its .ddev/config.yaml says it, a
# config.*.yaml after it as DDEV reads them: postgres, mysql or mariadb, mariadb when none says (DDEV's own default).
function rt_ddev_db_type() {
  local found root f t type='mariadb' ;
  found="$(rt_find_project "${1:-$PWD}" 2> /dev/null)" || { echo "${type}" ; return 0 ; } ;
  root="${found#* }" ;
  for f in "${root}"/.ddev/config.yaml "${root}"/.ddev/config.*.yaml ; do
    [ -f "${f}" ] || continue ;
    t="$(awk '
      /^database:[[:space:]]*\{/ { if (match($0, /type:[[:space:]]*["'\'']?[a-z]+/)) { v = substr($0, RSTART, RLENGTH) ; sub(/type:[[:space:]]*["'\'']?/, "", v) ; print v ; exit } }
      /^database:[[:space:]]*$/ { indb = 1 ; next }
      indb && /^[[:space:]]+type:/ { v = $0 ; sub(/^[[:space:]]+type:[[:space:]]*/, "", v) ; gsub(/["'\''[:space:]]/, "", v) ; print v ; exit }
      indb && /^[^[:space:]#]/ { indb = 0 }' "${f}")" ;
    [ -n "${t}" ] && type="${t}" ;
  done
  echo "${type}" ;
}

# DDEV's own import of a database into the DDEV project in the current folder, with DDEV's arguments (#968). DDEV drops
# the database before it imports, which PostgreSQL refuses while an application is connected to it ("database "db" is
# being accessed by other users"), as a used site's is. On PostgreSQL the database is closed to new connections first
# (ALLOW_CONNECTIONS false holds for superusers too) and its sessions are ended, so DDEV can drop it; after the import
# it is opened again, whatever the import did: DDEV checks a dump before it drops anything, and a dump it cannot read
# leaves the old database there, closed, until then. An application connects again by itself. MariaDB and MySQL, an
# import with --no-drop, and an import into another database by name go to DDEV as before.
function rt_ddev_import_db() {
  local a prev='' target='db' rc sessions ;
  for a in "$@" ; do
    case "${a}" in
      --no-drop) command ddev import-db "$@" ; return $? ;;
      --database=*) target="${a#--database=}" ;;
    esac
    case "${prev}" in -d|--database) target="${a}" ;; esac
    prev="${a}" ;
  done
  if [ "$(rt_ddev_db_type)" != postgres ] || [ "${target}" != db ] ; then
    command ddev import-db "$@" ;
    return $? ;
  fi
  if command ddev psql -d postgres -q -c 'ALTER DATABASE db WITH ALLOW_CONNECTIONS false' < /dev/null > /dev/null 2>&1 ; then
    sessions="$(command ddev psql -d postgres -tA -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = 'db' AND pid <> pg_backend_pid()" < /dev/null 2> /dev/null | tr -d '\r' | tail -n 1)" ;
    echo "The database db is closed to new connections, and its open sessions are ended (${sessions:-0}): DDEV's import drops it, which PostgreSQL refuses while an application is connected." ;
  fi
  command ddev import-db "$@" ;
  rc=$? ;
  if ! command ddev psql -d postgres -q -c 'ALTER DATABASE db WITH ALLOW_CONNECTIONS true' < /dev/null > /dev/null 2>&1 ; then
    echo "The database db could not be opened again after the import: ddev psql -d postgres -c 'ALTER DATABASE db WITH ALLOW_CONNECTIONS true', or restore the snapshot taken before." >&2 ;
    [ "${rc}" -eq 0 ] && rc=1 ;
  elif [ "${rc}" -ne 0 ] ; then
    echo "The import did not succeed: the database db is open again, as it was before the import." >&2 ;
  fi
  return "${rc}" ;
}

# Put <file> back as the database of the project in the current folder: through the platform's plugin when it keeps the
# database, else `ddev import-db` (as before). A project with no database has nothing to put it into.
function import_project_db() {
  local file="$1" p ;
  if [ ! -f "${file}" ] ; then
    echo "import_project_db: no such dump: ${file}" >&2 ;
    return 1 ;
  fi
  if [ -z "${RT_DB_HOOK_ACTIVE:-}" ] && p="$(rt_db_platform)" ; then
    RT_DB_HOOK_ACTIVE=1 "${p}_import_db" "${file}" ;
    return $? ;
  fi
  if ! rt_has_db ; then
    echo "This project has no database to put ${file##*/} into." >&2 ;
    return 1 ;
  fi
  ddev import-db --file="${file}" ;
}

# The dump of a project's backup, beside its archive (`<workspace>---<project>--<stamp>.tar.gz`) in the backups folder
# (#951): `<archive>-db<extension>` of the platform whose plugin keeps the project's database, as export_project_db
# names it, else the SQL forms DDEV and the runtimes write, `-db.sql.gz` or `-db.sql`. Run in the project's folder once
# its archive is extracted, so the plugin can say the project is its own. Prints the dump to import, or nothing: an
# empty dump (an older backup of a project with no database left one) is named and not imported, and a dump only a
# plugin can read, when no plugin of this workspace keeps the project's database, is named for the row's Import.
function project_dump_beside() {
  local archive="$1" base p f empty='' ;
  local -a names=() ;
  base="${archive%.tar.gz}" ;
  if p="$(rt_db_platform)" ; then names+=("${base}-db$(rt_db_extension "${p}")") ; fi
  names+=("${base}-db.sql.gz" "${base}-db.sql") ;
  for f in "${names[@]}" ; do
    [ -f "${f}" ] || continue ;
    if [ -s "${f}" ] ; then echo "${f}" ; return 0 ; fi
    [ -n "${empty}" ] || empty="${f}" ;
  done
  if [ -n "${empty}" ] ; then
    echo "${empty##*/} is empty: the project had no database to export when it was backed up, so there is none to import." >&2 ;
    return 0 ;
  fi
  for f in "${base}"-db.* ; do
    [ -s "${f}" ] || continue ;
    echo "${f##*/} is beside the archive, but no plugin of this workspace keeps this project's database: add the plugin of its platform, then import it from the row's menu." >&2 ;
    return 0 ;
  done
  return 0 ;
}

# A project put back from its archive (#951), in its folder once the archive is extracted: started (by DDEV, or its
# runtime), then its database imported from the dump beside the archive, through the runtime layer's `ddev import-db`,
# which hands it to the platform's plugin when one keeps the database, on DDEV as on the other runtimes. A project with
# no dump beside its archive (one with no database) is only started: its folder is the whole of it.
# On DDEV with PostgreSQL the project is started again after the import (#968): its application started on the empty
# database the start made, and may have set itself up on it (OpenProject seeds it, and stopped answering when the
# import replaced it under it); started again, it starts on the database the backup holds. DDEV cannot start a project's
# database alone, which would let the import come first. A MariaDB or MySQL application that sets itself up on an empty
# database when it starts would need the same, here.
function restore_project_db() {
  local archive="$1" dump ;
  dump="$(project_dump_beside "${archive}")" ;
  ddev start -y || return 1 ;
  [ -n "${dump}" ] || return 0 ;
  echo "Importing database…" ;
  ddev import-db --file="${dump}" || return $? ;
  if [ "$(runtime_of)" = ddev ] && ! rt_db_platform > /dev/null && [ "$(rt_ddev_db_type)" = postgres ] ; then
    echo "Starting the project again, so its application starts on the database the backup holds…" ;
    ddev restart ;
  fi
}

# The hook of the runtime layer's `ddev` function: `ddev export-db` and `ddev import-db` of a project whose platform's
# plugin keeps its database go to that plugin, on every runtime. Returns 125 when no plugin keeps it, and the caller
# then does what it always did. While the plugin's own function runs, RT_DB_HOOK_ACTIVE is set and the `ddev` function
# does not ask the hook again: a plugin that keeps its database beside DDEV's can dump that one too with `ddev
# export-db`, which is then DDEV's (or the runtime layer's) own, not a call back into itself.
function rt_db_hook() {
  local verb="$1" p file rc ;
  shift ;
  [ -n "${RT_DB_HOOK_ACTIVE:-}" ] && return 125 ;
  p="$(rt_db_platform)" || return 125 ;
  file="$(rt_file_arg "$@")" ;
  if [ -z "${file}" ] ; then
    echo "The database of this project is kept by its ${p} plugin, which writes and reads a file: ddev ${verb} --file=<path>." >&2 ;
    return 1 ;
  fi
  case "${verb}" in
    export-db) RT_DB_HOOK_ACTIVE=1 "${p}_export_db" "${file}" ; rc=$? ;;
    import-db) RT_DB_HOOK_ACTIVE=1 "${p}_import_db" "${file}" ; rc=$? ;;
    *) return 125 ;;
  esac
  return "${rc}" ;
}
