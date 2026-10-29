#!/usr/bin/env bash

# The command layer over fun-ddev-hostnames.sh: one project, or a listing of the
# whole workspace. Kept apart from the functions that touch DDEV so the reporting
# path cannot accidentally write anything.

function hostnames_command() {
  local workspace_dir="${WORKSPACE_ROOT}/${doc_name}"
  local project="${PROJECT_NAME}"

  if [ -z "${project}" ] || [ "${project}" == '_none_' ] ; then
    hostnames_list_workspace ;
    return 0 ;
  fi

  project="$(trim_project_name "${project}")"
  local dir="${workspace_dir}/${project}"
  if [ ! -d "${dir}" ] ; then
    echo "No project '${project}' in ${workspace_dir}." ; return 1 ;
  fi
  if [ ! -f "${dir}/.ddev/config.yaml" ] ; then
    echo "'${project}' is not a DDEV project — there is no hostname to change." ; return 1 ;
  fi

  local changed='no'
  if [ "${REMOVE}" != '_none_' ] && [ -n "${REMOVE}" ] ; then
    ddev_hostnames_remove "${dir}" "${REMOVE}" || return 1 ;
    changed='yes' ;
  fi
  local to_add=()
  [ "${ADD}" != '_none_' ] && [ -n "${ADD}" ] && to_add+=("${ADD}")
  if [ "${WITH_WORKSPACE}" == 'yes' ] ; then
    to_add+=("$(ddev_workspace_hostname "${project}" "${doc_name}")")
  fi
  if [ "${#to_add[@]}" -gt 0 ] ; then
    echo "Adding to ${doc_name}/${project}:" ;
    ddev_hostnames_add "${dir}" "${to_add[@]}" || return 1 ;
    changed='yes' ;
  fi

  echo "" ;
  echo "*---------------------------------------------------------------------*" ;
  echo "  ${doc_name}/${project} answers at" ;
  echo "*---------------------------------------------------------------------*" ;
  ddev_hostnames_report "${dir}" "${project}" "${doc_name}" ;

  # --start is honoured whether or not anything changed here. It was gated on
  # `changed` at first, so `--start` on a project whose hostname was added a
  # minute ago printed the report and did nothing — and the hostname stayed 404,
  # which looks exactly like the feature not working.
  if [ "${changed}" == 'yes' ] || [ "${START}" == 'yes' ] ; then
    if [ "${START}" == 'yes' ] ; then
      echo "" ;
      echo "Starting the project so the router picks the change up…" ;
      ( cd "${dir}" && ddev start -y ) || return 1 ;
    else
      echo "" ;
      echo "  Not live yet: a hostname reaches the router on the next start." ;
      echo "  Re-run with --start, or: cd ${dir} && ddev start" ;
    fi
  fi
}

# Every project in this workspace and what it answers at. The reason this exists
# as a listing: two projects claiming one hostname is invisible one project at a
# time, and it is exactly the mistake --with-workspace exists to avoid.
function hostnames_list_workspace() {
  local workspace_dir="${WORKSPACE_ROOT}/${doc_name}" d p extra tld
  tld="$(ddev_project_tld)"
  echo "*---------------------------------------------------------------------*" ;
  echo "  ${doc_name}: what each project answers at  (TLD: ${tld})" ;
  echo "*---------------------------------------------------------------------*" ;
  local found=0
  for d in "${workspace_dir}"/*/ ; do
    [ -d "${d}" ] || continue
    p="$(basename "${d}")"
    [ -f "${d}/.ddev/config.yaml" ] || continue
    found=$((found+1))
    extra="$(ddev_hostnames_list "${d}" | paste -sd' ' -)"
    printf "  %-34s %s\n" "${p}" "$(ddev_project_name "${d}" 2>/dev/null).${tld}" ;
    [ -n "${extra}" ] && printf "  %-34s + %s\n" "" "${extra}" ;
  done
  [ "${found}" -eq 0 ] && echo "  no DDEV projects here." ;
  echo "" ;
  echo "  Add one:     bash cmd-tools-hostnames.sh <project> --add <label> --start" ;
  echo "  Or the flat, workspace-qualified one (<project>-${doc_name}):" ;
  echo "               bash cmd-tools-hostnames.sh <project> --with-workspace --start" ;
}
