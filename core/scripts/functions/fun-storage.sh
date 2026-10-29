#!/usr/bin/env bash

# Second storage: whole workspace folders kept on another disk, each one a symlink from the tree.
#
# `storage.second` in settings.yml names the folder on that disk that holds them. A moved workspace is
# `<root>/<name> -> <storage>/<name>`, so every script and the dashboard keep using `<root>/<name>`.
#
# Three rules hold throughout:
#   * nothing is deleted without a flag that says so. A move keeps `<name>.pre-move`, a move back keeps
#     the copy on the drive;
#   * a copy is trusted only after a checksum compare finds no difference;
#   * a workspace that holds DDEV projects is refused. DDEV bind-mounts a project's folder into its
#     containers, and that has not been verified across a symlink onto another disk.

STORAGE_RSYNC_FLAGS="${STORAGE_RSYNC_FLAGS:--aHAX}";
STORAGE_COMPOSE_NAME="docker-compose.second-storage.yaml";

# The configured path, one layer of quotes stripped (parse_yaml keeps them), no trailing slash.
function storage_path() {
  local p="${storage_second:-}" ;
  p="${p#\"}" ; p="${p%\"}" ; p="${p#\'}" ; p="${p%\'}" ;
  case "${p}" in ''|CHANGE_ME|none|off) return 0 ;; esac
  printf '%s' "${p%/}" ;
}

function storage_say() { [ "${QUIET:-}" == 'yes' ] || echo "$@" ; }

function storage_is_workspace() {
  local w ;
  for w in "${workspaces[@]}" ; do [ "${w}" == "$1" ] && return 0 ; done
  return 1 ;
}

# local | second | elsewhere | broken | missing
#   second     a symlink into the configured storage path that resolves
#   elsewhere  a symlink that resolves, but not into the configured path
#   broken     a symlink whose target is not there: the drive is not mounted, or it moved
function storage_state() {
  local link="${WORKSPACE_ROOT}/$1" storage target ;
  storage="$(storage_path)" ;
  if [ -L "${link}" ] ; then
    target="$(readlink "${link}")" ;
    [ -d "${link}" ] || { echo 'broken' ; return 0 ; } ;
    if [ -n "${storage}" ] && [ "${target%/}" == "${storage}/$1" ] ; then echo 'second' ; else echo 'elsewhere' ; fi
  elif [ -d "${link}" ] ; then
    echo 'local' ;
  else
    echo 'missing' ;
  fi
}

# Any DDEV project inside, at the depths projects live at (a project, or a project inside a clone).
function storage_has_ddev() {
  [ -n "$(find "$1" -mindepth 2 -maxdepth 4 -type f -path '*/.ddev/config.yaml' -print -quit 2>/dev/null)" ] ;
}

function storage_avail_bytes() { df -B1 --output=avail "$1" 2>/dev/null | tail -1 | tr -d ' ' ; }
function storage_size_bytes()  { du -sb "$1" 2>/dev/null | cut -f1 ; }
function storage_human()       { numfmt --to=iec --suffix=B "${1:-0}" 2>/dev/null || echo "${1:-0} bytes" ; }

# True when both paths are on one filesystem, where a move frees nothing.
function storage_same_fs() {
  [ "$(stat -c %d "$1" 2>/dev/null)" == "$(stat -c %d "$2" 2>/dev/null)" ] ;
}

# The storage path exists and is on its own filesystem.
function storage_mounted() {
  local storage ; storage="$(storage_path)" ;
  [ -n "${storage}" ] && [ -d "${storage}" ] && ! storage_same_fs "${storage}" "${WORKSPACE_ROOT}" ;
}

# Room for size plus a margin: 5%, at least 1 GiB.
function storage_has_room() {
  local size="$1" dest="$2" avail margin ;
  avail="$(storage_avail_bytes "${dest}")" ;
  margin=$(( size / 20 )) ; [ "${margin}" -lt 1073741824 ] && margin=1073741824 ;
  [ -n "${avail}" ] && [ "${avail}" -ge $(( size + margin )) ] ;
}

# Lines that differ between two trees, by checksum. Empty means identical.
function storage_diff() {
  rsync ${STORAGE_RSYNC_FLAGS} -nc --delete --itemize-changes "$1/" "$2/" 2>&1 ;
}

function storage_copy() {
  rsync ${STORAGE_RSYNC_FLAGS} --delete "$1/" "$2/" ;
}

# Copy, then compare. Prints why and returns 1 on any difference.
function storage_copy_verified() {
  local from="$1" to="$2" diff ;
  storage_say "  copying ${from} → ${to}" ;
  if ! storage_copy "${from}" "${to}" ; then
    echo "  ✗ rsync failed. Nothing was swapped; ${from} is untouched." ; return 1 ;
  fi
  storage_say "  verifying by checksum" ;
  diff="$(storage_diff "${from}" "${to}")" ;
  if [ -n "${diff}" ] ; then
    echo "  ✗ The copy differs from the source ($(printf '%s\n' "${diff}" | wc -l) lines). Nothing was swapped:" ;
    printf '%s\n' "${diff}" | head -10 | sed 's/^/      /' ;
    return 1 ;
  fi
  storage_say "  ✓ identical" ;
}

# The mount the drive needs in the dashboard container, one host path per line, at the same path.
# Under /run/media/<user> the PARENT is mounted, because udisks picks the folder name at mount time
# (`workspace`, then `workspace1` when a stale `workspace` is in the way), and a bind of the parent with
# rslave also sees a drive mounted after the dashboard started.
function storage_mount_sources() {
  local storage link target ;
  storage="$(storage_path)" ;
  {
    [ -n "${storage}" ] && printf '%s\n' "${storage}" ;
    # Links that still point somewhere else (an old path) need their target too, or they break inside.
    for link in "${WORKSPACE_ROOT}"/* ; do
      [ -L "${link}" ] || continue ;
      target="$(readlink "${link}")" ;
      case "${target}" in /*) printf '%s\n' "$(dirname "${target}")" ;; esac
    done
  } | while read -r p ; do
    case "${p}" in
      "${WORKSPACE_ROOT}"|"${WORKSPACE_ROOT}"/*) ;;
      /run/media/*/*) printf '%s\n' "$(printf '%s' "${p}" | cut -d/ -f1-4)" ;;
      *) printf '%s\n' "${p}" ;;
    esac
  done | sort -u ;
}

function storage_compose() {
  local sources src ;
  sources="$(storage_mount_sources)" ;
  [ -n "${sources}" ] || return 0 ;
  echo "# Generated by core/scripts/storage.sh --mounts from storage.second in settings.yml." ;
  echo "# This machine only: never committed, and rewritten by every run. Edit the setting, not this file." ;
  echo "# The second storage, at the same path as on the host, so the workspace symlinks resolve in here." ;
  echo "services:" ;
  echo "  web:" ;
  echo "    volumes:" ;
  while read -r src ; do
    case "${src}" in
      /run/media/*) echo "      - ${src}:${src}:rslave" ;;
      *)            echo "      - ${src}:${src}" ;;
    esac
  done <<< "${sources}" ;
}

function storage_compose_file() { echo "${WORKSPACE_ROOT}/core/workspace-app/.ddev/${STORAGE_COMPOSE_NAME}" ; }

# Write (or remove) the dashboard's override. Says a restart is needed only when it changed.
function storage_write_mounts() {
  local file new old ;
  file="$(storage_compose_file)" ;
  [ -d "$(dirname "${file}")" ] || { echo "  ✗ No dashboard at $(dirname "$(dirname "${file}")")." ; return 1 ; } ;
  new="$(storage_compose)" ;
  old="$(cat "${file}" 2>/dev/null)" ;
  if [ "${new}" == "${old}" ] ; then
    storage_say "  ✓ dashboard mounts up to date${new:+ (${file##*/})}" ;
    return 0 ;
  fi
  if [ -z "${new}" ] ; then
    rm -f "${file}" ;
    echo "  ✓ removed ${file##*/}: no second storage is set or linked" ;
  else
    printf '%s\n' "${new}" > "${file}" ;
    echo "  ✓ wrote ${file#${WORKSPACE_ROOT}/}:" ;
    grep '^      - ' "${file}" | sed 's/^      - /      /' ;
  fi
  echo "    The dashboard picks it up on its next restart:" ;
  echo "      cd ${WORKSPACE_ROOT}/core/workspace-app && ddev restart" ;
  echo "    Check no build job is running first; a restart orphans it." ;
}

# The stable fix for a udisks mount whose path can change: an fstab line by UUID to a fixed point.
function storage_fstab_hint() {
  local storage mnt uuid fstype label point stale ;
  storage="$(storage_path)" ;
  case "${storage}" in /run/media/*) ;; *) return 0 ;; esac
  [ -d "${storage}" ] || return 0 ;
  mnt="$(findmnt -no TARGET -T "${storage}" 2>/dev/null)" ;
  uuid="$(findmnt -no UUID -T "${storage}" 2>/dev/null)" ;
  fstype="$(findmnt -no FSTYPE -T "${storage}" 2>/dev/null)" ;
  label="$(findmnt -no LABEL -T "${storage}" 2>/dev/null)" ;
  [ -n "${uuid}" ] || return 0 ;
  point="${STORAGE_MOUNT_POINT:-/mnt/workspace-storage}" ;
  # udisks names the folder after the label and adds a digit when that name is taken.
  stale="$(dirname "${mnt}")/${label}" ;
  echo "" ;
  echo "  ! ${mnt} is a udisks automount. Its path is picked at mount time (a leftover" ;
  echo "    folder named after the label makes udisks add a digit), so after a reboot every" ;
  echo "    workspace link can break. The stable fix, run by you (this tool never uses sudo):" ;
  echo "      (cd ${WORKSPACE_ROOT}/core/workspace-app && ddev stop)   # it holds the mount open" ;
  echo "      sudo mkdir -p ${point}" ;
  echo "      echo 'UUID=${uuid}  ${point}  ${fstype:-auto}  defaults,nofail,x-systemd.device-timeout=10s  0  2' | sudo tee -a /etc/fstab" ;
  echo "      sudo systemctl daemon-reload && sudo umount ${mnt} && sudo mount ${point}" ;
  if [ "${stale}" != "${mnt}" ] && [ -d "${stale}" ] && [ -z "$(ls -A "${stale}" 2>/dev/null)" ] ; then
    echo "      sudo rmdir ${stale}      # the empty leftover that pushed it to ${mnt##*/}" ;
  fi
  echo "    then set storage.second to ${point}${storage#${mnt}} and run:" ;
  echo "      bash ${WORKSPACE_SCRIPTS}/storage.sh --relink --mounts" ;
}

function storage_status() {
  local storage w state target size free_local free_second ;
  storage="$(storage_path)" ;
  echo "Second storage: ${storage:-not set (storage.second in settings.yml)}" ;
  if [ -n "${storage}" ] ; then
    if storage_mounted ; then
      free_second="$(storage_avail_bytes "${storage}")" ;
      echo "  mounted: $(findmnt -no TARGET,SOURCE,FSTYPE -T "${storage}" 2>/dev/null | tr -s ' ')" ;
      echo "  free:    $(storage_human "${free_second}")" ;
    elif [ -d "${storage}" ] ; then
      echo "  ✗ ${storage} is on the same filesystem as the workspace: the drive is not mounted there." ;
    else
      echo "  ✗ ${storage} does not exist: the drive is not mounted." ;
    fi
  fi
  free_local="$(storage_avail_bytes "${WORKSPACE_ROOT}")" ;
  echo "Workspace: ${WORKSPACE_ROOT}" ;
  echo "  free:    $(storage_human "${free_local}")" ;
  echo "" ;
  for w in "${workspaces[@]}" ; do
    state="$(storage_state "${w}")" ;
    target="" ;
    [ -L "${WORKSPACE_ROOT}/${w}" ] && target=" → $(readlink "${WORKSPACE_ROOT}/${w}")" ;
    case "${state}" in
      local)     printf '  %-16s local\n' "${w}" ;;
      second)    printf '  %-16s second storage%s\n' "${w}" "${target}" ;;
      elsewhere) printf '  %-16s ! linked elsewhere%s\n' "${w}" "${target}" ;;
      broken)    printf '  %-16s ✗ broken link%s\n' "${w}" "${target}" ;;
      missing)   printf '  %-16s (no folder)\n' "${w}" ;;
    esac
    if [ -d "${WORKSPACE_ROOT}/${w}.pre-move" ] ; then
      size="$(storage_size_bytes "${WORKSPACE_ROOT}/${w}.pre-move")" ;
      printf '  %-16s   %s.pre-move kept locally, %s (--remove-pre-move %s frees it)\n' "" "${w}" "$(storage_human "${size}")" "${w}" ;
    fi
  done
  if [ -n "$(storage_mount_sources)" ] && [ ! -f "$(storage_compose_file)" ] ; then
    echo "" ;
    echo "  ! The dashboard does not mount the second storage yet: run --mounts." ;
  fi
  storage_fstab_hint ;
}

function storage_move() {
  local w="$1" storage src dest size ;
  storage="$(storage_path)" ; src="${WORKSPACE_ROOT}/${w}" ; dest="${storage}/${w}" ;
  storage_is_workspace "${w}" || { echo "  ✗ ${w} is not a workspace in settings.yml." ; return 1 ; } ;
  [ -n "${storage}" ] || { echo "  ✗ Set storage.second in settings.yml first." ; return 1 ; } ;
  case "${storage}/" in "${WORKSPACE_ROOT}/"*) echo "  ✗ ${storage} is inside the workspace." ; return 1 ;; esac
  storage_mounted || { echo "  ✗ ${storage} is not mounted on its own filesystem." ; return 1 ; } ;
  [ -w "${storage}" ] || { echo "  ✗ ${storage} is not writable by $(id -un)." ; return 1 ; } ;
  [ "$(storage_state "${w}")" == 'local' ] || { echo "  ✗ ${w} is not a local folder ($(storage_state "${w}"))." ; return 1 ; } ;
  if storage_has_ddev "${src}" ; then
    echo "  ✗ ${w} holds DDEV projects. DDEV bind-mounts each project into its containers, and that" ;
    echo "    is not verified across a symlink onto another disk. Back them up or remove them first." ;
    return 1 ;
  fi
  [ -e "${src}.pre-move" ] && { echo "  ✗ ${src}.pre-move already exists. Remove it or move it aside first." ; return 1 ; } ;
  if [ -e "${dest}" ] && [ -n "$(ls -A "${dest}" 2>/dev/null)" ] ; then
    echo "  ✗ ${dest} already holds files. Nothing on the second storage is overwritten." ; return 1 ;
  fi
  size="$(storage_size_bytes "${src}")" ;
  if ! storage_has_room "${size}" "${storage}" ; then
    echo "  ✗ Not enough room: ${w} is $(storage_human "${size}"), ${storage} has $(storage_human "$(storage_avail_bytes "${storage}")") free (5%, at least 1 GiB, is kept spare)." ;
    return 1 ;
  fi
  echo "Moving ${w} ($(storage_human "${size}")) to ${dest}" ;
  if [ "${DRY_RUN:-}" == 'yes' ] ; then echo "  dry run: nothing copied." ; return 0 ; fi
  echo "  Nothing should write into ${w} until this finishes." ;
  mkdir -p "${dest}" || return 1 ;
  storage_copy_verified "${src}" "${dest}" || return 1 ;
  mv "${src}" "${src}.pre-move" || return 1 ;
  if ! ln -s "${dest}" "${src}" ; then
    mv "${src}.pre-move" "${src}" ; echo "  ✗ Could not make the link; ${w} is back where it was." ; return 1 ;
  fi
  echo "  ✓ ${src} → ${dest}" ;
  echo "  The original is kept as ${src}.pre-move. When you are happy, free it with:" ;
  echo "      bash ${WORKSPACE_SCRIPTS}/storage.sh --remove-pre-move ${w}" ;
}

function storage_back() {
  local w="$1" src target stage size ;
  src="${WORKSPACE_ROOT}/${w}" ;
  storage_is_workspace "${w}" || { echo "  ✗ ${w} is not a workspace in settings.yml." ; return 1 ; } ;
  case "$(storage_state "${w}")" in
    second|elsewhere) ;;
    broken) echo "  ✗ ${w} links to $(readlink "${src}"), which is not there. Mount the drive first." ; return 1 ;;
    *) echo "  ✗ ${w} is not on second storage." ; return 1 ;;
  esac
  target="$(readlink -f "${src}")" ;
  # A kept pre-move copy is the cheapest place to start: rsync only sends what changed since.
  stage="${src}.pre-move" ;
  [ -d "${stage}" ] || stage="${WORKSPACE_ROOT}/.${w}.moving-back" ;
  size="$(storage_size_bytes "${target}")" ;
  if ! storage_has_room "${size}" "${WORKSPACE_ROOT}" ; then
    echo "  ✗ Not enough room: ${w} is $(storage_human "${size}"), the workspace disk has $(storage_human "$(storage_avail_bytes "${WORKSPACE_ROOT}")") free." ;
    return 1 ;
  fi
  echo "Moving ${w} ($(storage_human "${size}")) back from ${target}" ;
  if [ "${DRY_RUN:-}" == 'yes' ] ; then echo "  dry run: nothing copied." ; return 0 ; fi
  mkdir -p "${stage}" || return 1 ;
  storage_copy_verified "${target}" "${stage}" || return 1 ;
  unlink "${src}" || return 1 ;
  if ! mv "${stage}" "${src}" ; then
    ln -s "${target}" "${src}" ; echo "  ✗ Could not put the folder in place; the link is restored." ; return 1 ;
  fi
  echo "  ✓ ${src} is a local folder again." ;
  echo "  The copy on the second storage is kept: ${target}" ;
  echo "  Delete it by hand when you no longer want it; this tool never deletes on the drive." ;
}

function storage_remove_pre_move() {
  local w="$1" kept="${WORKSPACE_ROOT}/$1.pre-move" ;
  [ -d "${kept}" ] || { echo "  ✗ There is no ${kept}." ; return 1 ; } ;
  case "$(storage_state "${w}")" in
    second|elsewhere) ;;
    *) echo "  ✗ ${w} is not a working link to second storage, so ${kept} may be the only copy. Kept." ; return 1 ;;
  esac
  [ -n "$(ls -A "${WORKSPACE_ROOT}/${w}/" 2>/dev/null)" ] || { echo "  ✗ ${w} on second storage is empty. Kept ${kept}." ; return 1 ; } ;
  if [ "${DRY_RUN:-}" == 'yes' ] ; then echo "  dry run: would remove ${kept}." ; return 0 ; fi
  rm -rf "${kept}" && echo "  ✓ removed ${kept}" ;
}

# Point links at the configured path when the same folder is there (the drive got a new mount point).
function storage_relink() {
  local storage w link target changed=0 ;
  storage="$(storage_path)" ;
  [ -n "${storage}" ] || { echo "  ✗ Set storage.second in settings.yml first." ; return 1 ; } ;
  for w in "${workspaces[@]}" ; do
    link="${WORKSPACE_ROOT}/${w}" ;
    [ -L "${link}" ] || continue ;
    target="$(readlink "${link}")" ;
    [ "${target%/}" == "${storage}/${w}" ] && continue ;
    if [ -d "${storage}/${w}" ] && [ -n "$(ls -A "${storage}/${w}" 2>/dev/null)" ] ; then
      if [ "${DRY_RUN:-}" == 'yes' ] ; then
        echo "  would relink ${w}: ${target} → ${storage}/${w}" ;
      else
        ln -sfn "${storage}/${w}" "${link}" && echo "  ✓ ${w}: ${target} → ${storage}/${w}" ;
      fi
      changed=$((changed+1)) ;
    else
      echo "  ! ${w} links to ${target}; ${storage}/${w} is not there, so it is left alone." ;
    fi
  done
  [ "${changed}" -gt 0 ] || storage_say "  ✓ every link already points at ${storage}" ;
}
