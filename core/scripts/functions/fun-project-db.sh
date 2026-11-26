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
  if p="$(rt_db_platform)" ; then
    file="${base}$(rt_db_extension "${p}")" ;
    "${p}_export_db" "${file}" || { rm -f "${file}" ; return 1 ; } ;
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
  if ! ddev export-db --file="${file}" ; then
    # A dump DDEV began and did not finish is not left behind for a restore to import.
    [ -s "${file}" ] || rm -f "${file}" ;
    return 1 ;
  fi
  PROJECT_DB_FILE="${file}" ;
}

# Put <file> back as the database of the project in the current folder: through the platform's plugin when it keeps the
# database, else `ddev import-db` (as before). A project with no database has nothing to put it into.
function import_project_db() {
  local file="$1" p ;
  if [ ! -f "${file}" ] ; then
    echo "import_project_db: no such dump: ${file}" >&2 ;
    return 1 ;
  fi
  if p="$(rt_db_platform)" ; then
    "${p}_import_db" "${file}" ;
    return $? ;
  fi
  if ! rt_has_db ; then
    echo "This project has no database to put ${file##*/} into." >&2 ;
    return 1 ;
  fi
  ddev import-db --file="${file}" ;
}

# The hook of the runtime layer's `ddev` function: `ddev export-db` and `ddev import-db` of a project whose platform's
# plugin keeps its database go to that plugin, on every runtime. Returns 125 when no plugin keeps it, and the caller
# then does what it always did.
function rt_db_hook() {
  local verb="$1" p file ;
  shift ;
  p="$(rt_db_platform)" || return 125 ;
  file="$(rt_file_arg "$@")" ;
  if [ -z "${file}" ] ; then
    echo "The database of this project is kept by its ${p} plugin, which writes and reads a file: ddev ${verb} --file=<path>." >&2 ;
    return 1 ;
  fi
  case "${verb}" in
    export-db) "${p}_export_db" "${file}" ;;
    import-db) "${p}_import_db" "${file}" ;;
    *) return 125 ;;
  esac
}
