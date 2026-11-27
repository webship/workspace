#!/usr/bin/env bash
# The container runtimes of the Webship Workspace (webship/workspace#694): DDEV by default, and Docker Compose,
# Podman, Kubernetes, Lando (#729) and Docksal (#730) for a project built with --runtime
# docker|podman|kubernetes|lando|docksal.
#
# Every builder, tool and menu speaks DDEV's verbs (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`,
# `ddev exec`, `ddev export-db` ...). On a DDEV project those are DDEV itself, exactly as before. On another runtime
# the `ddev` function below gives each verb its meaning there, so the same builders and plugins work unchanged.
#
# A project's runtime is what it carries: an `x-webship:` block, written by the Workspace (in compose.yaml for Docker,
# Podman, or Kubernetes, whose manifests are written from it into k8s/; in .lando.yml for Lando; in .docksal/docksal.yml
# for Docksal), else .ddev/config.yaml (DDEV), else a .lando.yml of the project's own (Lando), else a .docksal/ folder
# (Docksal). A new build takes WORKSPACE_RUNTIME (a builder's --runtime),
# else settings.yml's container.runtime, else DDEV.

RT_STACKS="${WORKSPACE_ROOT:-}/core/config/runtimes"

# The files that can carry the x-webship block, in the order they are read.
RT_META_FILES=(compose.yaml .lando.yml .docksal/docksal.yml)

# The file of a project that carries its x-webship block, relative to its root (compose.yaml when none does).
function rt_meta_file() {
  local f ;
  for f in "${RT_META_FILES[@]}" ; do
    [ -f "$1/${f}" ] && grep -q '^x-webship:' "$1/${f}" && { echo "${f}" ; return 0 ; } ;
  done
  echo compose.yaml ;
}

# A folder that is never a project's root: the machine's temporary folders, which every process shares (#772).
# /tmp/.docksal is Docksal's own (a folder per project for its ssh-agent socket), and Docksal's `fin` makes a project
# of the first folder above where it runs that has a .docksal/: run from a sandbox under /tmp it wrote docksal.env and
# docksal.yml into /tmp/.docksal, and every sandbox under /tmp became part of "the Docksal project /tmp".
function rt_never_a_root() {
  case "${1%/}" in /tmp|/var/tmp|/dev/shm) return 0 ;; esac
  [ -n "${TMPDIR:-}" ] && [ "${1%/}" = "${TMPDIR%/}" ] ;
}

# The project's root and runtime, looking up from a folder: "<runtime> <root>", or nothing.
function rt_find_project() {
  local d="${1:-$PWD}" f top="" ;
  d="$(cd "${d}" 2>/dev/null && pwd)" || return 1 ;
  # A look that starts in the workspace ends below the workspace's folder: that folder and every folder above it (the
  # home folder, /tmp for a workspace made there) are not under the workspace, and no project's root (#772).
  if [ -n "${WORKSPACE_ROOT:-}" ] ; then
    top="$(cd "${WORKSPACE_ROOT}" 2>/dev/null && pwd)" ;
    case "${d}/" in "${top}"/*) ;; *) top="" ;; esac
  fi
  while [ -n "${d}" ] && [ "${d}" != "/" ] && [ "${d}" != "${top}" ] ; do
    if rt_never_a_root "${d}" ; then d="$(dirname "${d}")" ; continue ; fi
    # The x-webship block first: only the Workspace writes it, on a build that is not DDEV's, and a project template
    # may ship a .ddev/ of its own (drupal/webship_project does), which must not turn that build into a DDEV one.
    for f in "${RT_META_FILES[@]}" ; do
      if [ -f "${d}/${f}" ] && grep -q '^x-webship:' "${d}/${f}" ; then
        echo "$(sed -n '/^x-webship:/,/^[^ ]/s/^  runtime: *//p' "${d}/${f}" | head -1 | tr -d '"') ${d}" ; return 0 ;
      fi
    done
    if [ -f "${d}/.ddev/config.yaml" ] ; then echo "ddev ${d}" ; return 0 ; fi
    # A Landofile of the project's own, which the Workspace did not write: Lando's (#729).
    if [ -f "${d}/.lando.yml" ] || [ -f "${d}/.lando.yaml" ] ; then echo "lando ${d}" ; return 0 ; fi
    # A .docksal/ folder of the project's own: Docksal's (#730). Never the home folder's: ~/.docksal is Docksal's own
    # settings (it holds a docksal.env), and Docksal does not take the home folder for a project either.
    if [ "${d}" != "${HOME%/}" ] && { [ -f "${d}/.docksal/docksal.env" ] || [ -f "${d}/.docksal/docksal.yml" ] ; } ; then echo "docksal ${d}" ; return 0 ; fi
    d="$(dirname "${d}")" ;
  done
  return 1 ;
}

# The runtime of a folder's project, or of a new build: ddev, docker, podman, kubernetes, lando or docksal.
function runtime_of() {
  local found ;
  found="$(rt_find_project "${1:-$PWD}")" && { echo "${found%% *}" ; return 0 ; } ;
  # A builder's --runtime (RUNTIME), else WORKSPACE_RUNTIME, else settings.yml's container.runtime, else DDEV.
  local asked="${RUNTIME:-_none_}" ; [ "${asked}" = '_none_' ] && asked="" ;
  echo "${asked:-${WORKSPACE_RUNTIME:-${container_runtime:-ddev}}}" ;
}

# Where Composer puts the project's commands: composer.json's config.bin-dir (drupal/webship_project has "bin/"),
# else vendor/bin. Drush is run from there.
function rt_bin_dir() {
  local dir="" ;
  [ -f "$1/composer.json" ] && dir="$(python3 -c 'import json,sys
try: print(str(json.load(open(sys.argv[1])).get("config",{}).get("bin-dir","")).strip("/"))
except Exception: pass' "$1/composer.json" 2>/dev/null)" ;
  [[ "${dir}" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "${dir}" != *..* ]] || dir="vendor/bin" ;
  echo "${dir}" ;
}

# A value of the project's x-webship block.
function rt_meta() {
  local f ; f="$2/$(rt_meta_file "$2")" ; [ -f "${f}" ] || return 0 ;
  sed -n '/^x-webship:/,/^[^ x]/s/^  '"$1"': *//p' "${f}" | head -1 | tr -d '"' ;
}

# The project's name: its x-webship block's, else the top-level `name:` of its file (compose.yaml, .lando.yml), else
# its folder's.
function rt_name() {
  local n f ; n="$(rt_meta name "$1")" ;
  if [ -z "${n}" ] ; then
    for f in "$(rt_meta_file "$1")" .lando.yml .lando.yaml ; do
      [ -f "$1/${f}" ] && n="$(sed -n 's/^name: *//p' "$1/${f}" | head -1 | tr -d "\"'")" ; [ -n "${n}" ] && break ;
    done
  fi
  echo "${n:-$(basename "$1")}" ;
}

# A platform plugin claims a project of a runtime: `platform: <plugin>` in the x-webship block, which is on these
# runtimes what the plugin's own `.ddev/config.<plugin>.yaml` is on DDEV (#490). A plugin whose platform is the
# project type itself (`ddev config --project-type=wordpress`) needs no claim: the type says it. One that builds on
# a type of no platform (php, generic) or on another platform's (a shop on wordpress) calls this after `ddev config`.
# On a DDEV project it changes nothing: there the plugin writes its own file, as before.
function rt_claim() {
  local plugin="$1" found root ;
  [[ "${plugin}" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "rt_claim: a plugin's name, please (lower case, digits, - and _)." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${2:-$PWD}")" || { echo "rt_claim: no project in ${2:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  [ "${found%% *}" = ddev ] && return 0 ;
  root="${found#* }" ;
  local file ; file="${root}/$(rt_meta_file "${root}")" ;
  grep -q '^x-webship:' "${file}" 2>/dev/null || { echo "rt_claim: ${root} was not built by the Workspace (no x-webship block)." >&2 ; return 1 ; } ;
  if [ -n "$(rt_meta platform "${root}")" ] ; then sed -i "/^x-webship:/,/^[^ x]/s/^  platform: .*/  platform: ${plugin}/" "${file}" ;
  else sed -i "/^x-webship:\$/a\\  platform: ${plugin}" "${file}" ; fi
}

# A project's own PHP settings, read on the input, where its runtime reads them (webship/workspace#825): on DDEV
# .ddev/php/<name>.ini, DDEV's own folder; on another runtime .webship/php/<name>.ini, which the web container scans
# after the stack's own settings (PHP_INI_SCAN_DIR, for the web server and the command line alike). PHP reads them
# when it starts: run it after `ddev config` and before the start, as a builder writes DDEV's file.
function rt_php_ini() {
  local name="$1" found root dir ;
  [[ "${name}" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "rt_php_ini: a name, please (lower case, digits, - and _)." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${2:-$PWD}")" || { echo "rt_php_ini: no project in ${2:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  root="${found#* }" ; dir="${root}/.webship/php" ;
  [ "${found%% *}" = ddev ] && dir="${root}/.ddev/php" ;
  mkdir -p "${dir}" && cat > "${dir}/${name}.ini" || return 1 ;
  # Docksal's pool settings win over ini files for the web server: its pool file says the project's again.
  [ "${found%% *}" = docksal ] && rt_docksal_fpm "${root}" ;
  return 0 ;
}

# A task kept running beside the web server, in the web container's image with the project's code and settings
# (webship/workspace#825): a platform's cron, a queue worker. On DDEV a web_extra_daemons entry in
# .ddev/config.daemon-<name>.yaml; on Docker Compose and Podman the project's `daemons` service, on Kubernetes a second
# container of the web pod, on Lando the appserver after each start, on Docksal a program of cli's supervisor, each
# running .webship/daemons/<name>.sh as the web server's user. The task is declared
# in the x-webship block (`daemons:`), so it stays when the files are written again. Run it after `ddev config`.
function rt_daemon() {
  local name="$1" command="${2:-}" found rt root file list ;
  { [[ "${name}" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [ -n "${command}" ] ; } || { echo "rt_daemon: a name (lower case, digits, - and _) and a command, please." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${3:-$PWD}")" || { echo "rt_daemon: no project in ${3:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  rt="${found%% *}" ; root="${found#* }" ;
  if [ "${rt}" = ddev ] ; then
    cat > "${root}/.ddev/config.daemon-${name}.yaml" <<YAML
# Written by the Webship Workspace (rt_daemon, webship/workspace#825): a task kept running beside the web server.
web_extra_daemons:
  - name: "${name}"
    command: "${command//\"/\\\"}"
    directory: /var/www/html
YAML
    return 0 ;
  fi
  mkdir -p "${root}/.webship/daemons" ;
  printf '#!/usr/bin/env bash\n# Written by the Webship Workspace (rt_daemon, webship/workspace#825): kept running beside the web server.\n%s\n' "${command}" > "${root}/.webship/daemons/${name}.sh" ;
  file="${root}/$(rt_meta_file "${root}")" ; list="$(rt_meta daemons "${root}")" ;
  case ",${list}," in *",${name},"*) ;; *) list="${list:+${list},}${name}" ;; esac
  if [ -n "$(rt_meta daemons "${root}")" ] ; then sed -i "/^x-webship:/,/^[^ x]/s/^  daemons: .*/  daemons: ${list}/" "${file}" ;
  else sed -i "/^x-webship:\$/a\\  daemons: ${list}" "${file}" ; fi
  # The runtime's files again, with the task in them: `ddev config` keeps what it is not asked to change.
  ( cd "${root}" && ddev config > /dev/null ) ;
}

# A key of the x-webship block, set or written (as rt_claim does with platform): rt_meta_set <key> <value> <root>.
function rt_meta_set() {
  local key="$1" value="$2" root="$3" file ; file="${root}/$(rt_meta_file "${root}")" ;
  if grep -q "^  ${key}: " "${file}" ; then sed -i "/^x-webship:/,/^[^ x]/s|^  ${key}: .*|  ${key}: ${value}|" "${file}" ;
  else sed -i "/^x-webship:\$/a\\  ${key}: ${value}" "${file}" ; fi
}

# The stack of an application that serves itself, on another runtime than DDEV (webship/workspace#841): its language
# and the version it chooses (python, node, java, dotnet, ruby, go), or `image <name>` for an image of its own. The
# layer builds the web image from the language's own image, pinned to that version, with what every stack has on top
# (core/config/runtimes/generic). Run it after `ddev config --webserver-type=generic`; on DDEV the plugin's own
# .ddev/web-build files stay as they are, and nothing is done here.
function rt_stack() {
  local lang="$1" version="${2:-}" found root ;
  case "${lang}" in python|node|java|dotnet|ruby|go|image) ;; *) echo "rt_stack: a language (python, node, java, dotnet, ruby, go) and its version, or image <name>." >&2 ; return 1 ;; esac
  [[ "${version}" =~ ^[A-Za-z0-9._:/@-]+$ ]] || { echo "rt_stack: the version ${lang} runs at (never latest: the application chooses it)." >&2 ; return 1 ; } ;
  [ "${version}" = latest ] && { echo "rt_stack: a pinned version, never latest." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${3:-$PWD}")" || { echo "rt_stack: no project in ${3:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  [ "${found%% *}" = ddev ] && return 0 ;
  root="${found#* }" ;
  if [ "${lang}" = image ] ; then
    # An image of the application's own is pinned too: a tag that is not latest, or a digest.
    { [[ "${version}" == *@sha256:* ]] || { [[ "${version##*/}" == *:* ]] && [ "${version##*:}" != latest ] ; } ; } \
      || { echo "rt_stack: image ${version}: a pinned image, please (name:tag or name@sha256:..., never latest)." >&2 ; return 1 ; } ;
    # The stack adds its layer with a shell and apt-get (Debian, Ubuntu) or apk (Alpine): an image with neither is
    # refused here, before anything is written, not half-way through a build.
    local cli=docker rc ; [ "${found%% *}" = podman ] && cli=podman ;
    # 3 is the probe's own answer for neither: a shell's `command -v` gives 127 for a missing command, as ${cli} does
    # for a missing shell, and 125 is ${cli}'s own for an image it cannot run.
    "${cli}" run --rm --entrypoint /bin/sh "${version}" -c 'command -v apt-get > /dev/null || command -v apk > /dev/null || exit 3' > /dev/null 2>&1 ; rc=$? ;
    case "${rc}" in
      0) ;;
      3) echo "rt_stack: image ${version} has neither apt-get (Debian, Ubuntu) nor apk (Alpine), which the generic stack adds its layer with (webship/workspace#841). Build the application's image FROM one of those, or build on DDEV." >&2 ; return 1 ;;
      126|127) echo "rt_stack: image ${version} has no shell (a distroless image?): the generic stack adds its layer with apt-get (Debian, Ubuntu) or apk (Alpine) (webship/workspace#841). Build the application's image FROM one of those, or build on DDEV." >&2 ; return 1 ;;
      *) echo "rt_stack: image ${version} could not be run to see what it is built on (is the name right, and can ${cli} pull it?)." >&2 ; return 1 ;;
    esac
  fi
  rt_meta_set stack generic "${root}" && rt_meta_set language "${lang}" "${root}" && rt_meta_set language_version "\"${version}\"" "${root}" || return 1 ;
  ( cd "${root}" && ddev config > /dev/null ) ;
}

# What the application adds to its stack's image, a Dockerfile fragment read on the input (what DDEV's
# .ddev/web-build/Dockerfile.<name> adds to DDEV's web image), on another runtime than DDEV (#841).
function rt_web_build() {
  local name="$1" found root ;
  [[ "${name}" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "rt_web_build: a name, please (lower case, digits, - and _)." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${2:-$PWD}")" || { echo "rt_web_build: no project in ${2:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  [ "${found%% *}" = ddev ] && { cat > /dev/null ; return 0 ; } ;
  root="${found#* }" ;
  mkdir -p "${root}/.webship/runtime/web-build" && cat > "${root}/.webship/runtime/web-build/Dockerfile.${name}" || return 1 ;
  ( cd "${root}" && ddev config > /dev/null ) ;
}

# The application's own server, on another runtime than DDEV (#841): the web container runs the command as the host
# user from the project's root, and the project's address goes to the port it listens on.
function rt_serve() {
  local port="$1" command="${2:-}" found root ;
  { [[ "${port}" =~ ^[0-9]+$ ]] && [ -n "${command}" ] ; } || { echo "rt_serve: the port the server listens on, and its command." >&2 ; return 1 ; } ;
  found="$(rt_find_project "${3:-$PWD}")" || { echo "rt_serve: no project in ${3:-$PWD} (run it after 'ddev config')." >&2 ; return 1 ; } ;
  [ "${found%% *}" = ddev ] && return 0 ;
  root="${found#* }" ;
  mkdir -p "${root}/.webship/runtime" ;
  printf '#!/usr/bin/env bash\n# Written by the Webship Workspace (rt_serve, webship/workspace#841): the application'"'"'s own server.\ncd "$(dirname "$0")/../.." || exit 1\n%s\n' "${command}" > "${root}/.webship/runtime/serve.sh" ;
  rt_meta_set serve_port "${port}" "${root}" || return 1 ;
  ( cd "${root}" && ddev config > /dev/null ) ;
}

# A service of the project's own beside its web server and database, on another runtime than DDEV (#900): a cache,
# a queue, a store. Kept in .webship/runtime/services/<name>.yaml, which every `ddev config` writes into compose.yaml
# (Docker Compose, Podman) and into the project's Kubernetes manifests, so it stays as the project is written again.
# Its process stopping on its own, it comes back on every runtime (rt_service_restart, #959).
#   rt_service <name> <image:tag> [--port <n>] [--env-file <file>] [--volume <path>] [--command "<line>"]
# The image is pinned (a tag that is not latest, or a digest); the env file is a file of the project, by its path from
# the project's root; the volume is the folder in the container its data is kept in, a volume of the project's own.
# On DDEV it does nothing: a plugin brings its own .ddev/docker-compose.<name>.yaml there.
function rt_service() {
  local name="${1:-}" image="${2:-}" port="" env_file="" volume="" command="" found root ;
  [[ "${name}" =~ ^[a-z][a-z0-9-]{0,30}$ ]] || { echo "rt_service: a name, please (lower case, digits and -, starting with a letter)." >&2 ; return 1 ; } ;
  case "${name}" in web|db|mail|mail-web|daemons) echo "rt_service: ${name} is a service of the stack's own: give yours another name." >&2 ; return 1 ;; esac
  { [[ "${image}" =~ ^[A-Za-z0-9._/:@-]+$ ]] && { [[ "${image}" == *@sha256:* ]] || { [[ "${image##*/}" == *:* ]] && [ "${image##*:}" != latest ] ; } ; } ; } \
    || { echo "rt_service: ${name}: a pinned image, please (name:tag or name@sha256:..., never latest)." >&2 ; return 1 ; } ;
  shift 2 ;
  while [ $# -gt 0 ] ; do
    case "$1" in
      --port) port="${2:-}" ;; --env-file) env_file="${2:-}" ;; --volume) volume="${2:-}" ;; --command) command="${2:-}" ;;
      *) echo "rt_service: ${name}: $1 is not an option of it (--port, --env-file, --volume, --command)." >&2 ; return 1 ;;
    esac
    shift 2 || { echo "rt_service: ${name}: $1 takes a value." >&2 ; return 1 ; } ;
  done
  if [ -n "${port}" ] && ! { [[ "${port}" =~ ^[0-9]{1,5}$ ]] && [ "${port}" -ge 1 ] && [ "${port}" -le 65535 ] ; } ; then
    echo "rt_service: ${name}: --port takes the port it listens on." >&2 ; return 1 ;
  fi
  if [ -n "${env_file}" ] && ! { [[ "${env_file}" =~ ^[A-Za-z0-9._-][A-Za-z0-9._/-]*$ ]] && [[ "${env_file}" != *..* ]] ; } ; then
    echo "rt_service: ${name}: --env-file takes a file of the project, by its path from the project's root." >&2 ; return 1 ;
  fi
  if [ -n "${volume}" ] && ! [[ "${volume}" =~ ^/[A-Za-z0-9._/-]*$ ]] ; then
    echo "rt_service: ${name}: --volume takes the folder in the container its data is kept in." >&2 ; return 1 ;
  fi
  [[ "${command}" != *$'\n'* ]] || { echo "rt_service: ${name}: --command takes one line." >&2 ; return 1 ; } ;
  found="$(rt_find_project "$PWD")" || { echo "rt_service: no project in $PWD (run it after 'ddev config')." >&2 ; return 1 ; } ;
  case "${found%% *}" in
    ddev) return 0 ;;
    docker|podman|kubernetes) ;;
    *) echo "rt_service: ${name}: a service of the project's own is written on Docker Compose, Podman and Kubernetes, not on ${found%% *} yet." >&2 ; return 1 ;;
  esac
  root="${found#* }" ;
  mkdir -p "${root}/.webship/runtime/services" || return 1 ;
  {
    printf '# Written by the Webship Workspace (rt_service, webship/workspace#900): a service of the project'"'"'s own, written\n' ;
    printf '# into compose.yaml and the Kubernetes manifests each time the project is. Change it with rt_service.\n' ;
    printf 'image: %s\n' "${image}" ;
    if [ -n "${port}" ] ; then printf 'port: %s\n' "${port}" ; fi ;
    if [ -n "${env_file}" ] ; then printf 'env_file: %s\n' "${env_file}" ; fi ;
    if [ -n "${volume}" ] ; then printf 'volume: %s\n' "${volume}" ; fi ;
    if [ -n "${command}" ] ; then printf 'command: %s\n' "${command}" ; fi ;
  } > "${root}/.webship/runtime/services/${name}.yaml" || return 1 ;
  ( cd "${root}" && ddev config > /dev/null ) ;
}

# The services of the project's own (rt_service), by name, in order; nothing for a project with none.
function rt_services() {
  local f ;
  for f in "$1"/.webship/runtime/services/*.yaml ; do
    [ -f "${f}" ] || continue ;
    f="${f##*/}" ; echo "${f%.yaml}" ;
  done | sort ;
}

# One value of a service of the project's own: image, port, env_file, volume or command.
function rt_service_value() { sed -n "s/^$3: //p" "$1/.webship/runtime/services/$2.yaml" 2> /dev/null | head -1 ; }

# A command line as a JSON list of its words (compose.yaml and the manifests take it as a YAML flow sequence).
function rt_words_json() { python3 -c 'import json, shlex, sys; print(json.dumps(shlex.split(sys.argv[1])))' "$1" ; }

# Is the project of a folder this platform's? On DDEV its project type, or the plugin's `.ddev/config.<name>.yaml`;
# on another runtime the type or the claim (rt_claim) of its x-webship block. A plugin's `<name>_is_project` asks
# this instead of reading .ddev/config.yaml, so it answers on every runtime. `-` and `_` in a name are one.
function rt_is_platform() {
  local dir="$1" name="${2//-/_}" found rt root type claim ;
  found="$(rt_find_project "${dir}")" || return 1 ;
  rt="${found%% *}" ; root="${found#* }" ;
  # The project is the folder itself, not one above it.
  [ "${root}" = "$(cd "${dir}" && pwd)" ] || return 1 ;
  if [ "${rt}" = ddev ] ; then
    type="$(sed -nE 's/^type:[[:space:]]*"?([A-Za-z0-9_-]+)"?[[:space:]]*$/\1/p' "${root}/.ddev/config.yaml" | head -1)" ;
    [ "${type//-/_}" = "${name}" ] && return 0 ;
    [ -f "${root}/.ddev/config.${2}.yaml" ] || [ -f "${root}/.ddev/config.${2}.yml" ] || [ -f "${root}/.ddev/config.${name//_/-}.yaml" ] || [ -f "${root}/.ddev/config.${name//_/-}.yml" ] ;
    return $? ;
  fi
  type="$(rt_meta type "${root}")" ; claim="$(rt_meta platform "${root}")" ;
  [ "${type//-/_}" = "${name}" ] || [ "${claim//-/_}" = "${name}" ] ;
}

# The address of the project's site.
function rt_url() {
  local found rt root ;
  found="$(rt_find_project "${1:-$PWD}")" || { echo "https://${PROJECT_NAME}.ddev.site" ; return 0 ; } ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    ddev) echo "https://$(sed -n 's/^name: *//p' "${root}/.ddev/config.yaml" | head -1).ddev.site" ;;
    kubernetes) echo "http://$(rt_k8s_node_ip):$(rt_meta port "${root}")" ;;
    # A Landofile of the project's own has no port of the Workspace: Lando's proxy address.
    lando) if [ -n "$(rt_meta port "${root}")" ] ; then echo "http://127.0.0.1:$(rt_meta port "${root}")" ; else echo "https://$(rt_lando_app "${root}").lndo.site" ; fi ;;
    # Docksal's own proxy answers for the project's host name.
    docksal) echo "http://$(rt_docksal_host "${root}")" ;;
    *) echo "http://127.0.0.1:$(rt_meta port "${root}")" ;;
  esac
}

# `ddev config --nodejs-version=<25 or later>` on DDEV: Node.js from 25 on links against libatomic, which DDEV's web
# image does not carry (DDEV 1.24.7: "node: error while loading shared libraries: libatomic.so.1"). The package goes
# on that `ddev config`, added to the packages the caller asked for, so every builder, a plugin's too, gets a Node.js
# that starts. Sets RT_DDEV_ARGS.
function rt_ddev_config_args() {
  RT_DDEV_ARGS=("$@") ;
  [ "${1:-}" = config ] || return 0 ;
  local a node="" i pkgs_at=-1 pkgs="" ;
  for i in "${!RT_DDEV_ARGS[@]}" ; do
    a="${RT_DDEV_ARGS[$i]}" ;
    case "${a}" in
      --nodejs-version=*) node="${a#--nodejs-version=}" ;;
      --webimage-extra-packages=*) pkgs_at="${i}" ; pkgs="${a#--webimage-extra-packages=}" ;;
    esac
  done
  [[ "${node}" =~ ^[0-9]+ ]] && [ "${BASH_REMATCH[0]}" -ge 25 ] || return 0 ;
  case ",${pkgs}," in *,libatomic1,*) return 0 ;; esac
  pkgs="${pkgs:+${pkgs},}libatomic1" ;
  if [ "${pkgs_at}" -ge 0 ] ; then RT_DDEV_ARGS[${pkgs_at}]="--webimage-extra-packages=${pkgs}" ;
  else RT_DDEV_ARGS+=("--webimage-extra-packages=${pkgs}") ; fi
}

# The address of the project's mailbox (Mailpit's own page and API), where the tests of a site read the mail it
# sent. On DDEV it is DDEV's; on Docker Compose and Podman a port of this machine, on Kubernetes a NodePort, both
# kept in compose.yaml as `mail_port`. Nothing for a project written before the mailbox had a port: `ddev config`
# and `ddev start` in it give it one.
function rt_mail_url() {
  local found rt root port ;
  found="$(rt_find_project "${1:-$PWD}")" || return 0 ;
  rt="${found%% *}" ; root="${found#* }" ;
  if [ "${rt}" = ddev ] ; then echo "https://$(sed -n 's/^name: *//p' "${root}/.ddev/config.yaml" | head -1).ddev.site:8026" ; return 0 ; fi
  # Docksal: its mail service has a host name of its own on Docksal's proxy.
  if [ "${rt}" = docksal ] ; then echo "http://mail.$(rt_docksal_host "${root}")" ; return 0 ; fi
  port="$(rt_meta mail_port "${root}")" ; [ -n "${port}" ] || return 0 ;
  # Lando: a port of this machine, as on Docker Compose.
  if [ "${rt}" = kubernetes ] ; then echo "http://$(rt_k8s_node_ip):${port}" ; else echo "http://127.0.0.1:${port}" ; fi
}

function ddev() {
  local rt rc ; rt="$(runtime_of)" ;
  # A platform whose plugin keeps the project's database its own way answers export-db and import-db itself, on every
  # runtime, DDEV's too (#937, fun-project-db.sh): 125 is "no plugin keeps it", and then the verb is what it always was.
  # Inside the plugin's own function (RT_DB_HOOK_ACTIVE) the verbs are DDEV's or the runtime layer's: no call back.
  case "${1:-}" in
    export-db|import-db)
      if declare -F rt_db_hook > /dev/null ; then
        rt_db_hook "$@" ; rc=$? ;
        [ "${rc}" -ne 125 ] && return "${rc}" ;
      fi ;;
  esac
  case "${rt}" in
    ''|ddev)
      # DDEV's import, through the core's own steps around it for a database on PostgreSQL (#968, fun-project-db.sh).
      if [ "${1:-}" = import-db ] && declare -F rt_ddev_import_db > /dev/null ; then shift ; rt_ddev_import_db "$@" ; return $? ; fi
      rt_ddev_config_args "$@" ; command ddev "${RT_DDEV_ARGS[@]}" ;;
    docker|podman) rt_compose "${rt}" "$@" ;;
    kubernetes) rt_k8s "$@" ;;
    lando) rt_lando "$@" ;;
    docksal) rt_docksal "$@" ;;
    *) echo "The ${rt} runtime cannot run 'ddev $1' yet (webship/workspace#694)." >&2 ; return 1 ;;
  esac
}

# --- Docker Compose and Podman ---------------------------------------------------------------------------------

# A project's database as a person reads it, from what compose.yaml keeps (#890): none, postgres:<v> or MariaDB's version.
function rt_db_words() {
  case "${1:-10.11}" in none) echo 'no database' ;; postgres:*) echo "PostgreSQL ${1#postgres:}" ;; *) echo "MariaDB ${1:-10.11}" ;; esac
}

function rt_free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])' ; }

# docker compose, or podman compose, in the project.
function rt_dc() {
  local rt="$1" root="$2" ; shift 2 ;
  if [ "${rt}" = podman ] ; then ( cd "${root}" && podman compose "$@" ) ; else ( cd "${root}" && docker compose "$@" ) ; fi
}

# docker compose, or podman compose, for a project by its name, from outside its folder (#935): a builder's
# drop_database asks for a project of the same name that way. Docker knows nothing of a Podman project.
function rt_dc_name() {
  local rt="$1" name="$2" ; shift 2 ;
  if [ "${rt}" = podman ] ; then podman compose -p "${name}" "$@" ; else docker compose -p "${name}" "$@" ; fi
}

# Writes compose.yaml and the stack's build folder for a project: what `ddev config` does for DDEV.
# The base image of a stack's language at a version, pinned to it, never `latest` (webship/workspace#841): the
# language's own image on Debian (Ubuntu for Java's), or an image the application names (`image <name>`).
function rt_stack_image() {
  local lang="$1" v="$2" ;
  case "${lang}" in
    python) echo "python:${v}-slim-bookworm" ;;
    node) echo "node:${v}-bookworm-slim" ;;
    java) echo "eclipse-temurin:${v}-jdk" ;;
    dotnet) echo "mcr.microsoft.com/dotnet/sdk:${v}" ;;
    ruby) echo "ruby:${v}-slim-bookworm" ;;
    go) echo "golang:${v}-bookworm" ;;
    image) echo "${v}" ;;
    *) echo "debian:bookworm-slim" ;;
  esac
}

# The Dockerfile of a generic stack: the stack's own (core/config/runtimes/generic), then the application's additions
# (rt_web_build: .webship/runtime/web-build/Dockerfile.<name>), in the order of their names. The command the web
# container runs is .webship/runtime/start.sh: it waits for the project's database (#850), then runs serve.sh, the
# application's server (rt_serve); until the application says it, the container waits.
function rt_generic_runtime() {
  local root="$1" db="${2:-none}" f engine=mariadb ;
  case "${db}" in none) engine=none ;; postgres:*) engine=postgres ;; esac
  mkdir -p "${root}/.webship/runtime" ;
  {
    cat "${RT_STACKS}/generic/Dockerfile" ;
    for f in "${root}"/.webship/runtime/web-build/Dockerfile.* ; do
      [ -f "${f}" ] || continue ;
      printf '\n# %s (rt_web_build)\n' "${f##*/}" ; cat "${f}" ;
    done
  } > "${root}/.webship/runtime/Dockerfile" ;
  [ -f "${root}/.webship/runtime/serve.sh" ] || printf '#!/usr/bin/env bash\n# Written by the Webship Workspace: the application has not said its server yet (rt_serve).\nexec sleep infinity\n' > "${root}/.webship/runtime/serve.sh" ;  # The server starts once the project's database takes connections (#850): a container can start before its database
  # and, on Kubernetes, before the cluster's DNS (a cluster started again), and a server that cannot reach its database
  # as it starts can stay down (Django's runserver waits on its reloader). Bounded: WEBSHIP_DB_WAIT seconds.
  cat > "${root}/.webship/runtime/start.sh" <<START
#!/usr/bin/env bash
# Written by the Webship Workspace (webship/workspace#850): the application's server (serve.sh, rt_serve) starts once
# the project's database (${engine}) takes connections, waiting at most WEBSHIP_DB_WAIT seconds (300 by default).
cd "\$(dirname "\$0")/../.." || exit 1
wait="\${WEBSHIP_DB_WAIT:-300}" ; waited=0
ready() {
START
  case "${engine}" in
    postgres) echo '  pg_isready -q -h db -U db' >> "${root}/.webship/runtime/start.sh" ;;
    mariadb) echo '  mariadb-admin ping -h db -u db -pdb --skip-ssl --silent > /dev/null 2>&1' >> "${root}/.webship/runtime/start.sh" ;;
    *) echo '  true' >> "${root}/.webship/runtime/start.sh" ;;
  esac
  cat >> "${root}/.webship/runtime/start.sh" <<START
}
until ready ; do
  [ "\${waited}" -ge "\${wait}" ] && { echo "The project's database (${engine} on db) did not answer in \${wait} s: the application's server is not started." >&2 ; exit 1 ; }
  [ "\${waited}" = 0 ] && echo "Waiting for the project's database (${engine} on db) before the application's server starts."
  sleep 2 ; waited=\$(( waited + 2 ))
done
exec bash .webship/runtime/serve.sh
START
  # Kubernetes' liveness probe of the server (#850). It answers: any HTTP response on its port within 5 s, a 500 too
  # (an application whose database restarts is not killed). It answered before in this container and does not now: it
  # is restarted. It never answered yet: fine for WEBSHIP_SERVE_GRACE seconds from the container's start (a build, the
  # migrations of a first start), restarted after.
  cat > "${root}/.webship/runtime/probe.sh" <<'PROBE'
#!/usr/bin/env bash
# Written by the Webship Workspace (webship/workspace#850): Kubernetes' liveness probe of the application's server.
port="${1:-8000}" grace="${WEBSHIP_SERVE_GRACE:-1800}"
served="${TMPDIR:-/tmp}/webship-served"
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${port}/" 2> /dev/null)"
if [ -n "${code}" ] && [ "${code}" != 000 ] ; then touch "${served}" ; exit 0 ; fi
[ -f "${served}" ] && { echo "The application's server answered on port ${port} before, and does not now." ; exit 1 ; }
up="$(ps -o etimes= -p 1 | tr -d ' ')"
[ "${up:-0}" -lt "${grace}" ] && exit 0
echo "The application's server has not answered on port ${port} in the ${grace} s since its container started." ; exit 1
PROBE
}

# The db service of compose.yaml for the project's database: MariaDB (a version, as before), PostgreSQL
# ("postgres:<version>", #841) or none. PostgreSQL keeps its data where its image says: /var/lib/postgresql from 18 on.
function rt_compose_db() {
  local db="$1" ;
  case "${db}" in
    none) return 0 ;;
    postgres:*)
      local v="${db#postgres:}" data=/var/lib/postgresql/data ;
      [ "${v%%.*}" -ge 18 ] 2>/dev/null && data=/var/lib/postgresql ;
      cat <<YAML
  db:
    image: postgres:${v}
    environment:
      POSTGRES_DB: db
      POSTGRES_USER: db
      POSTGRES_PASSWORD: db
    volumes:
      - db:${data}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U db -d db"]
      interval: 5s
      timeout: 5s
      retries: 60
YAML
      ;;
    *) cat <<YAML
  db:
    image: mariadb:${db}
    # DDEV's character set and collation, whatever the version: from 11.x on MariaDB's own default collation is one
    # an installer may not take (Moodle: "unicode"), and a site's database is the same on every runtime.
    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_general_ci"]
    environment:
      MARIADB_DATABASE: db
      MARIADB_USER: db
      MARIADB_PASSWORD: db
      MARIADB_ROOT_PASSWORD: root
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 60
YAML
      ;;
  esac
}

function rt_compose_write() {
  local rt="$1" root="$2" name="$3" type="$4" docroot="$5" php="$6" db="$7" port="$8" platform="${9:-}" mail_port="${10:-}" daemons="${11:-}" stack="${12:-php}" ;
  # A generic stack's language, version, own image and server port (#841), kept by `ddev config` as the claim is.
  local lang="${RT_STACK_LANG:-}" lang_version="${RT_STACK_VERSION:-}" serve_port="${RT_SERVE_PORT:-}" stack_lines="" ;
  [ -n "${lang}" ] && stack_lines="${stack_lines}"$'\n  language: '"${lang}" ;
  [ -n "${lang_version}" ] && stack_lines="${stack_lines}"$'\n  language_version: "'"${lang_version}"'"' ;
  [ -n "${serve_port}" ] && stack_lines="${stack_lines}"$'\n  serve_port: '"${serve_port}" ;
  # How long a generic stack's server waits for its database, and Kubernetes' grace for a server that never answered
  # yet (#850): WEBSHIP_DB_WAIT and WEBSHIP_SERVE_GRACE of `ddev config`, kept in x-webship when it writes again.
  local db_wait="" serve_grace="" ;
  if [ "${stack}" = generic ] ; then
    db_wait="${RT_DB_WAIT:-300}" ; [[ "${db_wait}" =~ ^[0-9]+$ ]] || db_wait=300 ;
    serve_grace="${RT_SERVE_GRACE:-1800}" ; [[ "${serve_grace}" =~ ^[0-9]+$ ]] || serve_grace=1800 ;
    stack_lines="${stack_lines}"$'\n  db_wait: '"${db_wait}"$'\n  serve_grace: '"${serve_grace}" ;
  fi
  mkdir -p "${root}/.webship/runtime" ;
  if [ "${stack}" = generic ] ; then rt_generic_runtime "${root}" "${db}" ; else cp "${RT_STACKS}/php/Dockerfile" "${root}/.webship/runtime/Dockerfile" ; fi ;
  # Rootless Podman maps a container's users into a range of their own: with keep-id the user of the web service is
  # the host user, so it can write the project folder it is given (found on a real Podman build, #694).
  local userns="" ;
  # The container still starts as root inside (user 0:0), so Apache can bind port 80; its workers are www-data.
  [ "${rt}" = podman ] && userns=$'    userns_mode: keep-id\n    user: "0:0"\n' ;
  # The mailbox, on this machine only: the tests of the site read the mail it sent there (MAIL_URL).
  local mail_ports="" ;
  [ -n "${mail_port}" ] && mail_ports=$'\n    # The mailbox, on this machine only (MAIL_URL).\n    ports:\n      - "127.0.0.1:'"${mail_port}"$':8025"' ;
  # The services of the project's own (rt_service, #900), and their volumes: nothing for a project with none.
  local services service_volumes ;
  services="$(rt_compose_services "${root}")" ; service_volumes="$(rt_compose_service_volumes "${root}")" ;
  cat > "${root}/compose.yaml" <<YAML
# Written by the Webship Workspace (its ${rt} runtime, webship/workspace#694). Run it with: ${rt} compose up -d
name: ${name}
x-webship:${platform:+
  platform: ${platform}}
  runtime: ${rt}
  stack: ${stack}${stack_lines}
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  port: ${port}${mail_port:+
  mail_port: ${mail_port}}${daemons:+
  daemons: ${daemons}}
services:
$(if [ "${stack}" = generic ] ; then rt_compose_generic_web "${rt}" "${name}" "${port}" "$(rt_stack_image "${lang}" "${lang_version}")" "${serve_port:-8000}" "${userns}" "${db}" "${db_wait}" "${root}" ; else cat <<WEB
  web:
    build:
      context: .webship/runtime
      args:
        PHP_VERSION: "${php}"
        UID: "$(id -u)"
        GID: "$(id -g)"
    image: webship-${name}-web
${userns}    environment:
      APACHE_DOCUMENT_ROOT: /var/www/html${docroot:+/${docroot}}
      WEBSHIP_RUNTIME: ${rt}
      # The project's own PHP settings (rt_php_ini), after the stack's: the leading ':' keeps PHP's own folder.
      PHP_INI_SCAN_DIR: ":/var/www/html/.webship/php"
      # The site's own port, also inside the container: it reaches itself at its address (the stack's Dockerfile).
      WEBSHIP_PORT: "${port}"
    volumes:
      - .:/var/www/html
    ports:
      - "127.0.0.1:${port}:80"$(rt_compose_depends "${db}" "${root}")
WEB
fi)
$(rt_compose_db "${db}")
  mail:
    image: axllent/mailpit${mail_ports}${daemons:+
$(rt_compose_daemons "${name}" "${php}" "${docroot}" "${rt}" "${userns}")}${services:+
${services}}
volumes:
  db:${service_volumes:+
${service_volumes}}
YAML
  # No database: the empty line its service would have left goes too, and its volume (the services' stay).
  if [ "${db}" = none ] && [ -n "${service_volumes}" ] ; then
    sed -i -e '/^services:$/,/^  mail:$/{/^$/d}' -e '/^volumes:$/,${/^  db:$/d}' "${root}/compose.yaml" ;
  elif [ "${db}" = none ] ; then
    sed -i -e '/^services:$/,/^  mail:$/{/^$/d}' -e '/^volumes:$/,$d' "${root}/compose.yaml" ;
  fi
  return 0 ;
}

# The web server waits for the project's database to be healthy, and for the project's own services to be started.
function rt_compose_depends() {
  local db="$1" root="$2" s out="" ;
  [ "${db}" = none ] || out=$'\n      db:\n        condition: service_healthy' ;
  [ -n "${root}" ] && for s in $(rt_services "${root}") ; do out="${out}"$'\n      '"${s}"$':\n        condition: service_started' ; done ;
  [ -n "${out}" ] && printf '\n    depends_on:%s' "${out}" ;
  return 0 ;
}

# How a service of the project's own comes back on Docker Compose and Podman when its process stops on its own (#959):
# on a failure, as a pod on Kubernetes starts its container again. A stop of the project stays a stop: neither compose
# nor Podman starts again a container that was stopped on purpose. The web container, the database and the mail catcher
# keep no policy: the web container ending is how the stack says its application did not start (start.sh, #850). A
# plugin that needs services to come back looks for this function, and says so on a core without it.
function rt_service_restart() { echo 'on-failure' ; }

# The services of the project's own (rt_service, #900) for compose.yaml: each its pinned image, its restart policy
# (rt_service_restart), its command, its env file of the project, the port it listens on in the project's network and
# its volume, which compose names after the project (its container too), so `down -v` and the removal take them with it.
function rt_compose_services() {
  local root="$1" s v ;
  for s in $(rt_services "${root}") ; do
    printf '  # A service of the project'"'"'s own (rt_service, webship/workspace#900).\n  %s:\n    image: "%s"\n' "${s}" "$(rt_service_value "${root}" "${s}" image)" ;
    printf '    restart: %s\n' "$(rt_service_restart)" ;
    # compose reads a $ as one of its variables: $$ is a $ of the command.
    v="$(rt_service_value "${root}" "${s}" command)" ; [ -n "${v}" ] && printf '    command: %s\n' "$(rt_words_json "${v}" | sed 's/\$/$$/g')" ;
    v="$(rt_service_value "${root}" "${s}" env_file)" ; [ -n "${v}" ] && printf '    env_file:\n      - %s\n' "${v}" ;
    v="$(rt_service_value "${root}" "${s}" port)" ; [ -n "${v}" ] && printf '    expose:\n      - "%s"\n' "${v}" ;
    v="$(rt_service_value "${root}" "${s}" volume)" ; [ -n "${v}" ] && printf '    volumes:\n      - svc-%s:%s\n' "${s}" "${v}" ;
  done | sed -e '$ s/\n$//' ;
  return 0 ;
}

# The volumes of the project's own services, for the volumes of compose.yaml (compose names them after the project).
function rt_compose_service_volumes() {
  local root="$1" s ;
  for s in $(rt_services "${root}") ; do
    [ -n "$(rt_service_value "${root}" "${s}" volume)" ] && printf '  svc-%s:\n' "${s}" ;
  done ;
  return 0 ;
}

# The web service of a generic stack (#841): the stack's image (its language, or the application's own) with the
# application's additions, its server (.webship/runtime/serve.sh, rt_serve) run as the host user from the project's
# root, and the project's address sent to the server's port.
function rt_compose_generic_web() {
  local rt="$1" name="$2" port="$3" base="$4" serve_port="$5" userns="$6" db="$7" db_wait="${8:-300}" root="${9:-}" ;
  cat <<YAML
  web:
    build:
      context: .webship/runtime
      args:
        BASE_IMAGE: "${base}"
        UID: "$(id -u)"
        GID: "$(id -g)"
    image: webship-${name}-web
${userns}    # The application's own server (rt_serve), as the host user, from the project's root, once its database takes
    # connections (start.sh, #850).
    command: ["runuser", "-u", "www-data", "--", "bash", "/var/www/html/.webship/runtime/start.sh"]
    working_dir: /var/www/html
    environment:
      WEBSHIP_RUNTIME: ${rt}
      WEBSHIP_PORT: "${port}"
      WEBSHIP_DB_WAIT: "${db_wait}"
    volumes:
      - .:/var/www/html
    ports:
      - "127.0.0.1:${port}:${serve_port}"$(rt_compose_depends "${db}" "${root}")
YAML
}

# The service of the tasks beside the web server (rt_daemon), for compose.yaml: the web service's image, code and
# settings, and every .webship/daemons/*.sh of the project run as the web server's user. `$$` is compose's `$`.
function rt_compose_daemons() {
  local name="$1" php="$2" docroot="$3" rt="$4" userns="$5" ;
  cat <<YAML
  # The tasks beside the web server (rt_daemon, webship/workspace#825).
  daemons:
    build:
      context: .webship/runtime
      args:
        PHP_VERSION: "${php}"
        UID: "$(id -u)"
        GID: "$(id -g)"
    image: webship-${name}-web
${userns}    command: ["runuser", "-u", "www-data", "--", "bash", "-c", "for f in /var/www/html/.webship/daemons/*.sh ; do [ -f \"\$\$f\" ] && bash \"\$\$f\" & done ; wait"]
    environment:
      APACHE_DOCUMENT_ROOT: /var/www/html${docroot:+/${docroot}}
      WEBSHIP_RUNTIME: ${rt}
      PHP_INI_SCAN_DIR: ":/var/www/html/.webship/php"
    volumes:
      - .:/var/www/html
    depends_on:
      db:
        condition: service_healthy
YAML
}

# What DDEV does on start for a Drupal project: settings.php from default.settings.php, and the database settings in
# a file of the runtime's own, included from settings.php (never a $databases block in settings.php itself).
function rt_drupal_settings() {
  # The database's host: db on Docker Compose, Podman and Kubernetes, Lando's database service on Lando.
  local root="$1" host="${2:-db}" docroot ; docroot="$(rt_meta docroot "${root}")" ;
  [[ "${host}" =~ ^[a-z0-9.-]+$ ]] || host=db ;
  local dir="${root}${docroot:+/${docroot}}/sites/default" ;
  [ -f "${dir}/default.settings.php" ] || return 0 ;
  [ -f "${dir}/settings.php" ] || { cp "${dir}/default.settings.php" "${dir}/settings.php" && chmod u+w "${dir}/settings.php" ; } ;
  cat > "${dir}/settings.webship-runtime.php" <<'PHP'
<?php

// Written by the Webship Workspace's container runtime (webship/workspace#694): the database of the project's
// compose stack. Included from settings.php when the site runs on that runtime.
$databases['default']['default'] = [
  'database' => 'db',
  'username' => 'db',
  'password' => 'db',
  'host' => 'db',
  'port' => 3306,
  'driver' => 'mysql',
  'prefix' => '',
  'collation' => 'utf8mb4_general_ci',
];
$settings['trusted_host_patterns'] = ['.*'];
// A development runtime, as DDEV's own settings say: Drupal leaves sites/default writable, so the folder can be
// removed and settings edited without a chmod first.
$settings['skip_permissions_hardening'] = TRUE;
if (empty($settings['hash_salt'])) {
  $settings['hash_salt'] = hash('sha256', __DIR__);
}
PHP
  sed -i "s/'host' => 'db',/'host' => '${host}',/" "${dir}/settings.webship-runtime.php" ;
  grep -q 'settings.webship-runtime.php' "${dir}/settings.php" || cat >> "${dir}/settings.php" <<'PHP'

// The Webship Workspace's container runtime (Docker, Podman, Kubernetes, Lando, Docksal): its database settings.
if (getenv('WEBSHIP_RUNTIME') && file_exists($app_root . '/' . $site_path . '/settings.webship-runtime.php')) {
  include $app_root . '/' . $site_path . '/settings.webship-runtime.php';
}
PHP
}

# `composer create-project <pkg> [.]` into a folder that already holds the runtime's files: as DDEV does, the project
# is created in a scratch folder in the container and copied in, so compose.yaml and .webship/ stay. As on DDEV, a
# create-project that names no folder makes the project in the project root, not in a folder named after the package
# (`ddev composer create-project codeigniter4/appstarter`). A folder other than "." is Composer's, as it is given:
# nothing is copied then, and the command ends with Composer's own exit code (#761).
function rt_create_project_cmd() {
  local args=() a positional=0 skip=0 after_package=-1 scratch=0 ;
  for a in "$@" ; do
    if [ ${skip} -eq 1 ] ; then args+=("${a}") ; skip=0 ; continue ; fi
    case "${a}" in
      # The options of create-project that take their value as the next argument.
      -s|--stability|--repository|--repository-url|--prefer-install|--ignore-platform-req) args+=("${a}") ; skip=1 ; continue ;;
      -*) args+=("${a}") ; continue ;;
    esac
    positional=$(( positional + 1 )) ;
    # create-project, the package, then the folder: "." is the project root.
    if [ ${positional} -eq 3 ] && [ "${a}" = "." ] ; then args+=("/tmp/webship-create") ; scratch=1 ; else args+=("${a}") ; fi
    [ ${positional} -eq 2 ] && after_package=${#args[@]} ;
  done
  # No folder named: the project root, as DDEV takes it.
  if [ ${positional} -eq 2 ] ; then args=("${args[@]:0:${after_package}}" "/tmp/webship-create" "${args[@]:${after_package}}") ; scratch=1 ; fi
  # The scratch folder is copied into the project root; a folder of the caller's own is where Composer made it.
  if [ ${scratch} -eq 1 ] ; then
    printf 'rm -rf /tmp/webship-create && composer %s && cp -a /tmp/webship-create/. "$PWD"/ && rm -rf /tmp/webship-create' "$(printf '%q ' "${args[@]}")" ;
  else
    printf 'composer %s' "$(printf '%q ' "${args[@]}")" ;
  fi
}

# --- The tests container ---------------------------------------------------------------------------------------
# Node.js and Playwright's browsers are not in a project's web image (the php stack is Apache and PHP). The JS side
# of a project (npm, npx, node, yarn: its webship-js suite) runs in a container of its own, from one image the
# Workspace builds once (core/config/runtimes/tests: Node.js 26 and the libraries the browsers link against), with
# the browsers and npm's cache in one named volume every project shares, as DDEV's global cache does. It runs on
# the host's network, so the site is reached at its own address (rt_url) on Docker, Podman and Kubernetes alike,
# and the project is mounted at its own path, so what a run writes is where the dashboard reads it.

RT_TESTS_IMAGE="${WORKSPACE_TESTS_IMAGE:-webship-workspace-tests}"
RT_TESTS_VOLUME="${WORKSPACE_TESTS_VOLUME:-webship-workspace-tests}"
RT_TESTS_BROWSERS_PATH='/cache/ms-playwright'

# The engine that runs containers for a runtime: podman for Podman, docker for Docker and Kubernetes.
function rt_engine() { if [ "$1" = podman ] ; then echo podman ; else echo docker ; fi ; }

# Builds the tests image when it is not there yet.
function rt_tests_image() {
  local engine="$1" ;
  "${engine}" image inspect "${RT_TESTS_IMAGE}" > /dev/null 2>&1 && return 0 ;
  echo "Building the tests image ${RT_TESTS_IMAGE} (once): Node.js 26 and the libraries Playwright's browsers need." ;
  "${engine}" build -t "${RT_TESTS_IMAGE}" "${RT_STACKS}/tests" ;
}

# A command line in the tests container, in a folder of the project (a path on the host).
function rt_tests_run() {
  local rt="$1" root="$2" dir="$3" ; shift 3 ;
  local engine userns=() ; engine="$(rt_engine "${rt}")" ;
  # In a pod (the dashboard on Kubernetes) there is no Docker to run the tests container with: said, not left to
  # the engine's own words.
  if [ -n "${KUBERNETES_SERVICE_HOST:-}" ] && ! "${engine}" info > /dev/null 2>&1 ; then
    echo "The tests container needs ${engine} where the dashboard runs, and a dashboard in a pod has none yet (webship/workspace#694). The site's tests are set up and run from a machine with ${engine} that has this workspace: bash cmd-tools-testing.sh <project> in the site's folder of the workspace." >&2 ;
    return 1 ;
  fi
  rt_tests_image "${engine}" || return 1 ;
  [ "${engine}" = podman ] && userns=(--userns=keep-id) ;
  # The mailbox of the site, for the steps that read the mail it sent: a pack's cucumber.js reads MAIL_URL.
  local mail=() mail_url ; mail_url="$(rt_mail_url "${root}")" ; [ -n "${mail_url}" ] && mail=(-e "MAIL_URL=${mail_url}") ;
  "${engine}" run --rm --network host "${userns[@]}" --user "$(id -u):$(id -g)" \
    -v "${root}:${root}" -v "${RT_TESTS_VOLUME}:/cache" -w "${dir}" \
    -e "LAUNCH_URL=$(rt_url "${root}")" "${mail[@]}" "${RT_TESTS_IMAGE}" bash -c "$*" ;
}

# The command line of `ddev exec`, as DDEV reads it: one argument is a line for bash ("cd x && y"); several are a
# command and its arguments, each kept whole ("php run.php edit --summary=\"Two words\"" keeps its two words),
# as DDEV runs them (its --raw, the default with several).
function rt_exec_line() {
  if [ $# -le 1 ] ; then printf '%s' "${1:-}" ; else printf '%q ' "$@" ; fi
}

# `--file=<path>` or `--file <path>` (and --src) among a verb's arguments.
function rt_file_arg() {
  local file="" ;
  while [ $# -gt 0 ] ; do
    case "$1" in
      --file=*|--src=*) file="${1#*=}" ;;
      --file|--src|-f) file="${2:-}" ; shift ;;
    esac
    shift ;
  done
  echo "${file}" ;
}

# Does a gzipped dump hold anything? A dump command that wrote nothing still leaves a few bytes of gzip.
function rt_dump_has_content() {
  [ -n "$(gunzip -c "$1" 2> /dev/null | head -c 64 | tr -d '\0')" ] ;
}

# `ddev describe -j`: the two values the tools read from DDEV's own answer, in its shape.
function rt_describe_json() {
  local name="$1" status="$2" url="$3" rt="$4" ;
  printf '{"raw":{"name":"%s","status":"%s","primary_url":"%s","runtime":"%s"}}\n' "${name}" "${status}" "${url}" "${rt}" ;
}

# Import a dump into a project's PostgreSQL (#841), safely: the dump is read and checked first, the client and the
# database are asked separately, the dump goes into a database of its own, and only a whole import takes the place of
# `db`. Anything short of that fails loudly, and the project's database is left as it was. $2 is a function that runs a
# command in the database's container, its input passed on (rt_compose's and rt_k8s's own).
function rt_pg_import() {
  local file="$1" dbx="$2" head ;
  [ -s "${file}" ] || { echo "import-db: ${file} is missing or empty: the database is untouched." >&2 ; return 1 ; } ;
  case "${file}" in
    *.gz) gunzip -t "${file}" 2> /dev/null || { echo "import-db: ${file} is not a whole gzip file: the database is untouched." >&2 ; return 1 ; } ;
          head="$(gunzip -c "${file}" | head -c 4096)" ;;
    *) head="$(head -c 4096 "${file}")" ;;
  esac
  grep -q 'PostgreSQL database dump' <<< "${head}" || { echo "import-db: ${file} is not a PostgreSQL dump (pg_dump's plain SQL): the database is untouched." >&2 ; return 1 ; } ;
  # A whole gzip can still hold a dump cut short (a pg_dump that stopped while gzip finished): pg_dump ends every whole
  # dump with its own last line, which psql would not miss.
  local tail ;
  case "${file}" in *.gz) tail="$(gunzip -c "${file}" | tail -c 4096)" ;; *) tail="$(tail -c 4096 "${file}")" ;; esac
  grep -q -- '-- PostgreSQL database dump complete' <<< "${tail}" || { echo "import-db: ${file} is a PostgreSQL dump cut short (it does not end with pg_dump's 'PostgreSQL database dump complete'): the database is untouched." >&2 ; return 1 ; } ;
  "${dbx}" psql --version > /dev/null 2>&1 || { echo "import-db: no psql in the database's container: the database is untouched." >&2 ; return 1 ; } ;
  "${dbx}" psql -U db -d postgres -tAc 'SELECT 1' 2> /dev/null | grep -q '^1$' || { echo "import-db: the database does not answer: it is untouched." >&2 ; return 1 ; } ;
  "${dbx}" psql -U db -d postgres -q -c 'SET client_min_messages = warning' -c 'DROP DATABASE IF EXISTS db_webship_import' > /dev/null && "${dbx}" psql -U db -d postgres -qc 'CREATE DATABASE db_webship_import OWNER db' > /dev/null \
    || { echo "import-db: a database for the import could not be made: the project's database is untouched." >&2 ; return 1 ; } ;
  if ! case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | "${dbx}" psql -U db -d db_webship_import -v ON_ERROR_STOP=1 -q > /dev/null ; then
    "${dbx}" psql -U db -d postgres -qc 'DROP DATABASE IF EXISTS db_webship_import' > /dev/null 2>&1 ;
    echo "import-db: the dump stopped on an error: the project's database is untouched." >&2 ; return 1 ;
  fi
  # The import is whole: it takes the place of db. db takes no new connection first: an application's server, a pool
  # above all, would otherwise connect again between the closing of its connections and the rename. Then its
  # connections are closed, and the two renames are one transaction, both or neither. One session does it all, so db
  # is closed for the milliseconds of the swap. A connection that was starting as db closed can still be there for
  # the renames, which then wait for it and fail: the swap is tried again. On failure db is opened again, as it was.
  local try swapped= ;
  for try in 1 2 3 ; do
    "${dbx}" psql -U db -d postgres -v ON_ERROR_STOP=1 -q > /dev/null 2>&1 <<'SQL' && { swapped=1 ; break ; }
ALTER DATABASE db ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'db' AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE db RENAME TO db_webship_old;
ALTER DATABASE db_webship_import RENAME TO db;
COMMIT;
SQL
  done
  if [ -z "${swapped}" ] ; then
    "${dbx}" psql -U db -d postgres -qc 'ALTER DATABASE db ALLOW_CONNECTIONS true' > /dev/null 2>&1 \
      || { echo "import-db: the imported database could not take the place of db, and db could not be opened again by itself: ddev psql -d postgres -c 'ALTER DATABASE db ALLOW_CONNECTIONS true' (the dump is in db_webship_import)." >&2 ; return 1 ; } ;
    echo "import-db: the imported database could not take the place of db (three tries): db is as it was, open again (the dump is in db_webship_import)." >&2 ; return 1 ;
  fi
  # The old database goes: it takes no connection, and none is left to it.
  "${dbx}" psql -U db -d postgres -qc 'DROP DATABASE IF EXISTS db_webship_old' > /dev/null 2>&1 \
    || echo "import-db: the dump is the project's database now; the old one, db_webship_old, could not be removed (ddev psql -c 'DROP DATABASE db_webship_old')." >&2 ;
  return 0 ;
}

function rt_compose() {
  local rt="$1" ; shift ;
  local verb="${1:-}" ; shift || true ;
  local found root="" rel="" ;
  found="$(rt_find_project)" && root="${found#* }" ;
  [ -n "${root}" ] && rel="${PWD#${root}}" ;
  local workdir="/var/www/html${rel}" ;
  case "${verb}" in
    config)
      [ "${1:-}" = global ] && return 0 ;
      root="${root:-$PWD}" ;
      local name type docroot php db port platform mail_port a ;
      name="$( [ -f "${root}/compose.yaml" ] && sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1 )" ;
      type="$( [ -f "${root}/compose.yaml" ] && rt_meta type "${root}" )" ; docroot="$( [ -f "${root}/compose.yaml" ] && rt_meta docroot "${root}" )" ;
      php="$( [ -f "${root}/compose.yaml" ] && rt_meta php "${root}" )" ; db="$( [ -f "${root}/compose.yaml" ] && rt_meta database "${root}" )" ;
      port="$( [ -f "${root}/compose.yaml" ] && rt_meta port "${root}" )" ;
      # A plugin's claim (rt_claim) stays when the file is written again.
      platform="$( [ -f "${root}/compose.yaml" ] && rt_meta platform "${root}" )" ;
      mail_port="$( [ -f "${root}/compose.yaml" ] && rt_meta mail_port "${root}" )" ;
      # The tasks beside the web server (rt_daemon) stay too, and a generic stack's language and server (#841).
      local daemons stack ; daemons="$( [ -f "${root}/compose.yaml" ] && rt_meta daemons "${root}" )" ;
      stack="$( [ -f "${root}/compose.yaml" ] && rt_meta stack "${root}" )" ;
      local RT_STACK_LANG RT_STACK_VERSION RT_SERVE_PORT RT_DB_WAIT RT_SERVE_GRACE ;
      if [ -f "${root}/compose.yaml" ] ; then
        RT_STACK_LANG="$(rt_meta language "${root}")" ; RT_STACK_VERSION="$(rt_meta language_version "${root}")" ; RT_SERVE_PORT="$(rt_meta serve_port "${root}")" ;
        RT_DB_WAIT="$(rt_meta db_wait "${root}")" ; RT_SERVE_GRACE="$(rt_meta serve_grace "${root}")" ;
      fi
      RT_DB_WAIT="${WEBSHIP_DB_WAIT:-${RT_DB_WAIT}}" ; RT_SERVE_GRACE="${WEBSHIP_SERVE_GRACE:-${RT_SERVE_GRACE}}" ;
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          --php-version=*) php="${a#*=}" ;;
          # MariaDB as its version (as before); PostgreSQL by its name and version, which the PostgreSQL plugin reads.
          --database=postgres:*) db="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
          --omit-containers=*) case ",${a#*=}," in *,db,*) db=none ;; esac ;;
          # An application that serves itself (DDEV's generic web server): a generic stack, no Apache.
          --webserver-type=generic) stack=generic ;; --webserver-type=*) stack=php ;;
        esac
      done
      RT_STACK_LANG="${RT_STACK_LANG}" RT_STACK_VERSION="${RT_STACK_VERSION}" RT_SERVE_PORT="${RT_SERVE_PORT}" RT_DB_WAIT="${RT_DB_WAIT}" RT_SERVE_GRACE="${RT_SERVE_GRACE}" \
        rt_compose_write "${rt}" "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" "${platform}" "${mail_port:-$(rt_free_port)}" "${daemons}" "${stack:-php}" ;
      # What was written, as it is: a generic stack has no PHP, and the database is the project's (#890).
      if [ "${stack:-php}" = generic ] ; then
        echo "Wrote compose.yaml for ${rt} (generic, $(rt_db_words "${db:-10.11}")): $(rt_url "${root}")" ;
      else
        echo "Wrote compose.yaml for ${rt} (${type:-php}, PHP ${php:-8.3}, $(rt_db_words "${db:-10.11}")): $(rt_url "${root}")" ;
      fi ;;
    start|restart)
      [ -n "${root}" ] || { echo "No ${rt} project here." >&2 ; return 1 ; } ;
      # A restart stops what runs first: `up` alone leaves running containers as they are.
      [ "${verb}" = restart ] && { rt_dc "${rt}" "${root}" stop || return 1 ; } ;
      rt_dc "${rt}" "${root}" up -d --build --wait || return 1 ;
      case "$(rt_meta type "${root}")" in drupal*) rt_drupal_settings "${root}" ;; esac ;
      echo "Running on ${rt}: $(rt_url "${root}")" ;;
    stop) rt_dc "${rt}" "${root}" stop ;;
    poweroff|list|add-on|get|snapshot|xdebug|mutagen|auth|share|hostname|debug|self-upgrade) echo "(${rt}: 'ddev ${verb}' has nothing to do here)" ;;
    describe)
      if [ -n "${1:-}" ] && [ -z "${root}" ] ; then
        [ -n "$( (rt_dc_name "${rt}" "$1" ps -q 2>/dev/null || true) )" ] ; return $? ;
      fi
      [ -n "${root}" ] || return 1 ;
      case "${1:-}" in -j|--json-output)
        local up=stopped ; [ -n "$(rt_dc "${rt}" "${root}" ps --status running -q web 2>/dev/null)" ] && up=running ;
        rt_describe_json "$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" "${up}" "$(rt_url "${root}")" "${rt}" ; return 0 ;;
      esac
      echo "$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1) on ${rt}: $(rt_url "${root}")" ; rt_dc "${rt}" "${root}" ps ;;
    delete)
      if [ -n "${root}" ] ; then rt_dc "${rt}" "${root}" down -v --remove-orphans ;
      else local n ; for n in "$@" ; do case "${n}" in -*) ;; *) rt_dc_name "${rt}" "${n}" down -v --remove-orphans 2>/dev/null ;; esac ; done ; fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web bash -c "$(rt_create_project_cmd "$@")" ;
      else rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web composer "$@" ; fi ;;
    drush) rt_dc "${rt}" "${root}" exec -T -u www-data -w "/var/www/html" web "/var/www/html/$(rt_bin_dir "${root}")/drush" "$@" ;;
    php|wp) rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web "${verb}" "$@" ;;
    npm|npx|node|yarn) rt_tests_run "${rt}" "${root}" "${PWD}" "${verb} $(printf '%q ' "$@")" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; --) shift ; break ;; *) break ;; esac ; done
      local line ; line="$(rt_exec_line "$@")" ;
      if [ "${svc}" = tests ] ; then rt_tests_run "${rt}" "${root}" "${PWD}" "${line}" ; return $? ; fi
      rt_dc "${rt}" "${root}" exec -T -u "$( [ "${svc}" = web ] && echo www-data || echo root )" -w "${workdir}" "${svc}" bash -c "${line}" ;;
    ssh)
      # At a terminal (a screen session of the dashboard, whose output is also logged through a pipe) the shell gets
      # a terminal of its own, so it shows its prompt: compose leaves it out when its output is not one.
      if [ -t 0 ] ; then "$(rt_engine "${rt}")" exec -it -u www-data "$(rt_dc "${rt}" "${root}" ps -q web | head -1)" bash ;
      else rt_dc "${rt}" "${root}" exec -u www-data web bash ; fi ;;
    mysql|psql|export-db|import-db)
      # The project's database decides the client (#841): MariaDB, PostgreSQL, or none.
      local dbase ; dbase="$(rt_meta database "${root}")" ;
      dbx() { rt_dc "${rt}" "${root}" exec -T db "$@" ; } ;
      case "${dbase}" in
        none) echo "This project has no database." >&2 ; return 1 ;;
        postgres:*) case "${verb}" in
          mysql) echo "The database of this project is PostgreSQL: ddev psql." >&2 ; return 1 ;;
          psql) dbx psql -U db -d db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then dbx pg_dump -U db --no-owner --no-privileges db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else dbx pg_dump -U db --no-owner --no-privileges db | gzip ; fi ;;
          import-db) rt_pg_import "$(rt_file_arg "$@")" dbx ;;
        esac ;;
        *) case "${verb}" in
          psql) echo "The database of this project is MariaDB: ddev mysql." >&2 ; return 1 ;;
          mysql) dbx mariadb -udb -pdb db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then dbx mariadb-dump -udb -pdb db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else dbx mariadb-dump -udb -pdb db | gzip ; fi ;;
          import-db)
            local file ; file="$(rt_file_arg "$@")" ;
            [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
            case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | dbx mariadb -udb -pdb db ;;
        esac ;;
      esac ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) rt_dc "${rt}" "${root}" logs --tail "${LOG_LINES:-200}" web ;;
    version|--version|-v) echo "the Webship Workspace's ${rt} runtime (no DDEV)" ;;
    *) echo "The ${rt} runtime cannot run 'ddev ${verb}' (webship/workspace#694)." >&2 ; return 1 ;;
  esac
}

# --- Kubernetes -------------------------------------------------------------------------------------------------
# The same stack as manifests in k8s/ (a namespace per project: ws-<name>), applied to WORKSPACE_KUBE_CONTEXT, else a
# kind cluster "webship" this creates (with the workspace mounted into the node, so the pods see the code where it
# is). The web image is built here and loaded into kind; the web Service is a NodePort on the node's address.

RT_KIND_CLUSTER="${WORKSPACE_KIND_CLUSTER:-webship}"
function rt_kctx() { echo "${WORKSPACE_KUBE_CONTEXT:-kind-${RT_KIND_CLUSTER}}" ; }
function rt_kubectl() { kubectl --context "$(rt_kctx)" "$@" ; }

function rt_k8s_cluster() {
  rt_kubectl get nodes > /dev/null 2>&1 && return 0 ;
  if [ -z "${WORKSPACE_KUBE_CONTEXT:-}" ] && command -v kind > /dev/null ; then
    # /home, and the workspace root when it lives elsewhere, mounted into the node at the same path, so a pod's
    # hostPath sees the code where it is. Never /tmp itself: kind mounts its own there.
    local mounts="  - hostPath: /home\n    containerPath: /home\n" ;
    case "${WORKSPACE_ROOT:-/home}" in /home|/home/*) ;; *) mounts="${mounts}  - hostPath: ${WORKSPACE_ROOT}\n    containerPath: ${WORKSPACE_ROOT}\n" ;; esac ;
    echo "Creating the kind cluster ${RT_KIND_CLUSTER} (once), with the workspace mounted into its node." ;
    printf "kind: Cluster\napiVersion: kind.x-k8s.io/v1alpha4\nnodes:\n- role: control-plane\n  extraMounts:\n${mounts}" \
      | kind create cluster --name "${RT_KIND_CLUSTER}" --config - --wait 120s || return 1 ;
    return 0 ;
  fi
  echo "No Kubernetes cluster answers on the context $(rt_kctx): set WORKSPACE_KUBE_CONTEXT, or install kind." >&2 ; return 1 ;
}

function rt_k8s_node_ip() {
  rt_kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null ;
}

# A NodePort no Service of the cluster holds yet.
function rt_k8s_free_nodeport() {
  # "$@": ports that are taken although no Service holds them yet (the site's own, when its mailbox is given one).
  local used p ; used="$(rt_kubectl get svc -A -o jsonpath='{range .items[*]}{range .spec.ports[*]}{.nodePort} {end}{end}' 2>/dev/null) $*" ;
  for p in $(seq 30080 32767) ; do case " ${used} " in *" ${p} "*) ;; *) echo "${p}" ; return 0 ;; esac ; done ;
}

# The image of a site's web container. By default it is built for the site from its .webship/runtime (and loaded into
# a kind cluster). Where nothing can build one (the dashboard in a pod has no Docker), WORKSPACE_KUBE_WEB_IMAGE names
# an image the cluster already has or can pull, built from core/config/runtimes/php: `{php}` in it is the site's PHP
# version (webship-workspace-php:{php}).
function rt_k8s_web_image() {
  local root="$1" name ; name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ;
  if [ -n "${WORKSPACE_KUBE_WEB_IMAGE:-}" ] ; then echo "${WORKSPACE_KUBE_WEB_IMAGE//\{php\}/$(rt_meta php "${root}")}" ;
  else echo "webship-${name}-web" ; fi
}

# The database part of a project's Kubernetes stack (#841): MariaDB (as before), PostgreSQL ("postgres:<version>", its
# data where its image says), or none. Each begins with its own "---".
function rt_k8s_db() {
  local db="$1" ;
  case "${db}" in
    none) return 0 ;;
    postgres:*)
      local v="${db#postgres:}" data=/var/lib/postgresql/data ;
      [ "${v%%.*}" -ge 18 ] 2>/dev/null && data=/var/lib/postgresql ;
      cat <<YAML
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: db}
  template:
    metadata:
      labels: {app: db}
    spec:
      enableServiceLinks: false
      containers:
        - name: db
          image: postgres:${v}
          env:
            - {name: POSTGRES_DB, value: db}
            - {name: POSTGRES_USER, value: db}
            - {name: POSTGRES_PASSWORD, value: db}
            # The data in a folder of the volume: its root holds lost+found, which initdb refuses.
            - {name: PGDATA, value: ${data}/pgdata}
          ports: [{containerPort: 5432}]
          readinessProbe:
            exec: {command: ["pg_isready", "-U", "db", "-d", "db"]}
            periodSeconds: 5
          volumeMounts: [{name: data, mountPath: ${data}}]
      volumes:
        - name: data
          persistentVolumeClaim: {claimName: db}
---
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  selector: {app: db}
  ports: [{port: 5432}]
YAML
      ;;
    *) cat <<YAML
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels: {app: db}
  template:
    metadata:
      labels: {app: db}
    spec:
      # No service links: Kubernetes would hand every container DB_PORT=tcp://<address>:3306, MAIL_PORT=… for the
      # services db and mail, which an app reads before its own .env (a Laravel app's mail failed on them).
      enableServiceLinks: false
      containers:
        - name: db
          image: mariadb:${db}
          # DDEV's character set and collation, whatever the version (the same as compose.yaml's db service).
          args: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_general_ci"]
          env:
            - {name: MARIADB_DATABASE, value: db}
            - {name: MARIADB_USER, value: db}
            - {name: MARIADB_PASSWORD, value: db}
            - {name: MARIADB_ROOT_PASSWORD, value: root}
          ports: [{containerPort: 3306}]
          readinessProbe:
            exec: {command: ["healthcheck.sh", "--connect", "--innodb_initialized"]}
            periodSeconds: 5
          volumeMounts: [{name: data, mountPath: /var/lib/mysql}]
      volumes:
        - name: data
          persistentVolumeClaim: {claimName: db}
---
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  selector: {app: db}
  ports: [{port: 3306}]
YAML
      ;;
  esac
}

function rt_k8s_write() {
  local root="$1" name type docroot php db port mail_port ns image pull=Never daemons sidecar="" ;
  name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ; docroot="$(rt_meta docroot "${root}")" ;
  daemons="$(rt_meta daemons "${root}")" ;
  # A generic stack (#841): the application's own server, as the host user from the project's root, on its port.
  local serve_port="" serve_cmd="" serve_env="" ;
  if [ "$(rt_meta stack "${root}")" = generic ] ; then
    serve_port="$(rt_meta serve_port "${root}")" ; serve_port="${serve_port:-8000}" ;
    local db_wait serve_grace ; db_wait="$(rt_meta db_wait "${root}")" ; serve_grace="$(rt_meta serve_grace "${root}")" ;
    serve_env=$'\n            # How long the server waits for its database, and the grace of one that never answered yet (#850).\n            - {name: WEBSHIP_DB_WAIT, value: "'"${db_wait:-300}"$'"}\n            - {name: WEBSHIP_SERVE_GRACE, value: "'"${serve_grace:-1800}"$'"}' ;
    # Once its database takes connections (start.sh); restarted when it stops answering, or never answers after the
    # grace (probe.sh, #850). No startup probe: the pod is ready as soon as it runs, as `ddev start` waits for it
    # before a build has made the application its server serves.
    serve_cmd=$'\n          command: ["runuser", "-u", "www-data", "--", "bash", "/var/www/html/.webship/runtime/start.sh"]\n          workingDir: /var/www/html'
    serve_cmd="${serve_cmd}"$'\n          livenessProbe:\n            exec: {command: ["bash", "/var/www/html/.webship/runtime/probe.sh", "'"${serve_port}"$'"]}\n            periodSeconds: 10\n            timeoutSeconds: 10\n            failureThreshold: 3' ;
  fi
  db="$(rt_meta database "${root}")" ; port="$(rt_meta port "${root}")" ; mail_port="$(rt_meta mail_port "${root}")" ; ns="ws-${name}" ;
  image="$(rt_k8s_web_image "${root}")" ; [ "${image}" = "webship-${name}-web" ] || pull=IfNotPresent ;
  mkdir -p "${root}/k8s" ;
  # The tasks beside the web server (rt_daemon, webship/workspace#825): a second container of the web pod, with its
  # image, code and settings, running every .webship/daemons/*.sh as the web server's user.
  [ -n "${daemons}" ] && sidecar="
        - name: daemons
          image: ${image}
          imagePullPolicy: ${pull}
          command: [\"runuser\", \"-u\", \"www-data\", \"--\", \"bash\", \"-c\", \"for f in /var/www/html/.webship/daemons/*.sh ; do [ -f \\\"\$f\\\" ] && bash \\\"\$f\\\" & done ; wait\"]
          env:
            - {name: APACHE_DOCUMENT_ROOT, value: /var/www/html${docroot:+/${docroot}}}
            - {name: WEBSHIP_RUNTIME, value: kubernetes}
            - {name: PHP_INI_SCAN_DIR, value: \":/var/www/html/.webship/php\"}
          volumeMounts: [{name: code, mountPath: /var/www/html}]" ;
  cat > "${root}/k8s/kustomization.yaml" <<YAML
# Written by the Webship Workspace's kubernetes runtime (webship/workspace#694) from compose.yaml.
namespace: ${ns}
resources:
  - stack.yaml
YAML
  cat > "${root}/k8s/stack.yaml" <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
$(rt_k8s_db "${db}")
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mail
spec:
  replicas: 1
  selector:
    matchLabels: {app: mail}
  template:
    metadata:
      labels: {app: mail}
    spec:
      # No service links: Kubernetes would hand every container DB_PORT=tcp://<address>:3306, MAIL_PORT=… for the
      # services db and mail, which an app reads before its own .env (a Laravel app's mail failed on them).
      enableServiceLinks: false
      containers:
        - name: mail
          image: axllent/mailpit
          ports: [{containerPort: 1025}, {containerPort: 8025}]
---
apiVersion: v1
kind: Service
metadata:
  name: mail
spec:
  selector: {app: mail}
  ports: [{name: smtp, port: 1025}, {name: web, port: 8025}]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      # No service links: Kubernetes would hand every container DB_PORT=tcp://<address>:3306, MAIL_PORT=… for the
      # services db and mail, which an app reads before its own .env (a Laravel app's mail failed on them).
      enableServiceLinks: false
      containers:
        - name: web
          image: ${image}
          imagePullPolicy: ${pull}
          env:
            - {name: APACHE_DOCUMENT_ROOT, value: /var/www/html${docroot:+/${docroot}}}
            - {name: WEBSHIP_RUNTIME, value: kubernetes}
            # The project's own PHP settings (rt_php_ini), after the stack's: the leading ':' keeps PHP's own folder.
            - {name: PHP_INI_SCAN_DIR, value: ":/var/www/html/.webship/php"}${serve_env}
          ports: [{containerPort: ${serve_port:-80}}]${serve_cmd}
          volumeMounts: [{name: code, mountPath: /var/www/html}]${sidecar}
      volumes:
        - name: code
          hostPath: {path: ${root}, type: Directory}
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  type: NodePort
  selector: {app: web}
  ports: [{port: 80, nodePort: ${port}${serve_port:+, targetPort: ${serve_port}}}]
YAML
  # The mailbox on a NodePort of its own, where the tests of the site read the mail it sent (MAIL_URL).
  [ -z "${mail_port}" ] || cat >> "${root}/k8s/stack.yaml" <<YAML
---
apiVersion: v1
kind: Service
metadata:
  name: mail-web
spec:
  type: NodePort
  selector: {app: mail}
  ports: [{port: 8025, nodePort: ${mail_port}}]
YAML
  rt_k8s_services "${root}" ;
}

# The services of the project's own (rt_service, #900) in the project's namespace: for each, a Deployment of its
# pinned image, a ClusterIP Service on its port (its name is its host name, as in compose.yaml) and a PVC for its
# volume; its env file of the project becomes a Secret of the kustomization (a copy in k8s/services/, which only you
# can read). A project with none gets no file and no line of them.
function rt_k8s_services() {
  local root="$1" s image port env_file volume command list ;
  rm -rf "${root:?}/k8s/services" "${root:?}/k8s/services.yaml" ;
  list="$(rt_services "${root}")" ;
  [ -n "${list}" ] || return 0 ;
  mkdir -p "${root}/k8s/services" && chmod 700 "${root}/k8s/services" || return 1 ;
  printf '  - services.yaml\n' >> "${root}/k8s/kustomization.yaml" ;
  local generators="" ;
  for s in ${list} ; do
    image="$(rt_service_value "${root}" "${s}" image)" ; port="$(rt_service_value "${root}" "${s}" port)" ;
    env_file="$(rt_service_value "${root}" "${s}" env_file)" ; volume="$(rt_service_value "${root}" "${s}" volume)" ;
    command="$(rt_service_value "${root}" "${s}" command)" ;
    if [ -n "${env_file}" ] && [ ! -f "${root}/${env_file}" ] ; then
      echo "rt_service: ${s}: its env file ${env_file} is not in the project; the service starts without it." >&2 ; env_file="" ;
    fi
    if [ -n "${env_file}" ] ; then
      install -m 600 "${root}/${env_file}" "${root}/k8s/services/${s}.env" || return 1 ;
      generators="${generators}"$'\n  - name: '"${s}"$'-env\n    envs: [services/'"${s}"$'.env]' ;
    fi
    {
      if [ -n "${volume}" ] ; then
        printf -- '---\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: svc-%s\nspec:\n  accessModes: ["ReadWriteOnce"]\n  resources:\n    requests:\n      storage: 2Gi\n' "${s}" ;
      fi
      printf -- '---\n# A service of the project'"'"'s own (rt_service, webship/workspace#900).\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: %s\nspec:\n  replicas: 1\n' "${s}" ;
      if [ -n "${volume}" ] ; then printf '  strategy:\n    type: Recreate\n' ; fi ;
      printf '  selector:\n    matchLabels: {app: %s}\n  template:\n    metadata:\n      labels: {app: %s}\n    spec:\n      enableServiceLinks: false\n      containers:\n        - name: %s\n          image: %s\n          imagePullPolicy: IfNotPresent\n' "${s}" "${s}" "${s}" "${image}" ;
      if [ -n "${command}" ] ; then printf '          args: %s\n' "$(rt_words_json "${command}")" ; fi ;
      if [ -n "${env_file}" ] ; then printf '          envFrom: [{secretRef: {name: %s-env}}]\n' "${s}" ; fi ;
      if [ -n "${port}" ] ; then printf '          ports: [{containerPort: %s}]\n' "${port}" ; fi ;
      if [ -n "${volume}" ] ; then
        printf '          volumeMounts: [{name: data, mountPath: %s}]\n      volumes:\n        - name: data\n          persistentVolumeClaim: {claimName: svc-%s}\n' "${volume}" "${s}" ;
      fi
      if [ -n "${port}" ] ; then
        printf -- '---\napiVersion: v1\nkind: Service\nmetadata:\n  name: %s\nspec:\n  selector: {app: %s}\n  ports: [{port: %s}]\n' "${s}" "${s}" "${port}" ;
      fi
    } >> "${root}/k8s/services.yaml" ;
  done
  [ -z "${generators}" ] || printf 'secretGenerator:%s\n' "${generators}" >> "${root}/k8s/kustomization.yaml" ;
  return 0 ;
}

function rt_k8s_ns() { echo "ws-$(sed -n 's/^name: *//p' "$1/compose.yaml" | head -1)" ; }

function rt_k8s() {
  local verb="${1:-}" ; shift || true ;
  local found root="" rel="" ;
  found="$(rt_find_project)" && root="${found#* }" ;
  [ -n "${root}" ] && rel="${PWD#${root}}" ;
  local workdir="/var/www/html${rel}" ns="" ;
  [ -n "${root}" ] && ns="$(rt_k8s_ns "${root}")" ;
  # A command in the web (as the host user, www-data) or the db pod.
  kx() { local svc="$1" ; shift ; rt_kubectl -n "${ns}" exec -i "deploy/${svc}" -c "${svc}" -- "$@" ; } ;
  case "${verb}" in
    config)
      [ "${1:-}" = global ] && return 0 ;
      rt_k8s_cluster || return 1 ;
      local port="" mail_port="" ; [ -n "${root}" ] && { port="$(rt_meta port "${root}")" ; mail_port="$(rt_meta mail_port "${root}")" ; } ;
      root="${root:-$PWD}" ;
      rt_compose kubernetes config "$@" > /dev/null || return 1 ;
      [ -n "${port}" ] || sed -i "s/^  port: .*/  port: $(rt_k8s_free_nodeport)/" "${root}/compose.yaml" ;
      [ -n "${mail_port}" ] || sed -i "s/^  mail_port: .*/  mail_port: $(rt_k8s_free_nodeport "$(rt_meta port "${root}")")/" "${root}/compose.yaml" ;
      sed -i '/^    # The mailbox, on this machine only (MAIL_URL)\.$/d' "${root}/compose.yaml" ;
      sed -i '/^    ports:$/,/^      - "127.0.0.1:/d' "${root}/compose.yaml" ;
      # No port of this machine on Kubernetes: the address is the node's, which a pod reaches as it is.
      sed -i '/^      # The site.s own port, also inside the container/,/^      WEBSHIP_PORT: /d' "${root}/compose.yaml" ;
      rt_k8s_write "${root}" ;
      echo "Wrote compose.yaml and k8s/ for kubernetes ($(rt_kctx)): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No kubernetes project here." >&2 ; return 1 ; } ;
      rt_k8s_cluster || return 1 ;
      local name ; name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ;
      # The site's own image is built and loaded; an image the manifests name instead (WORKSPACE_KUBE_WEB_IMAGE when
      # they were written) is the cluster's to find.
      if grep -q "^ *image: webship-${name}-web\$" "${root}/k8s/stack.yaml" 2> /dev/null ; then
        docker build -q -t "webship-${name}-web" --build-arg PHP_VERSION="$(rt_meta php "${root}")" --build-arg BASE_IMAGE="$(rt_stack_image "$(rt_meta language "${root}")" "$(rt_meta language_version "${root}")")" --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" "${root}/.webship/runtime" > /dev/null || return 1 ;
        case "$(rt_kctx)" in kind-*) kind load docker-image "webship-${name}-web" --name "${RT_KIND_CLUSTER}" > /dev/null || return 1 ;; esac ;
      fi
      rt_kubectl apply -k "${root}/k8s" > /dev/null || return 1 ;
      [ "${verb}" = restart ] && rt_kubectl -n "${ns}" rollout restart deploy/web > /dev/null ;
      rt_kubectl -n "${ns}" scale deploy --all --replicas=1 > /dev/null ;
      # The database first, when the project has one: `ddev config --omit-containers=db` gives a project none, and
      # its manifests no db Deployment to wait for (#883).
      { [ "$(rt_meta database "${root}")" = none ] || rt_kubectl -n "${ns}" rollout status deploy/db --timeout=900s > /dev/null ; } \
        && rt_kubectl -n "${ns}" rollout status deploy/web --timeout=900s > /dev/null || return 1 ;
      case "$(rt_meta type "${root}")" in drupal*) rt_drupal_settings "${root}" ;; esac ;
      echo "Running on kubernetes ($(rt_kctx), namespace ${ns}): $(rt_url "${root}")" ;;
    stop) rt_kubectl -n "${ns}" scale deploy --all --replicas=0 ;;
    poweroff|list|add-on|get|snapshot|xdebug|mutagen|auth|share|hostname|debug|self-upgrade) echo "(kubernetes: 'ddev ${verb}' has nothing to do here)" ;;
    describe)
      if [ -n "${1:-}" ] && [ -z "${root}" ] ; then rt_kubectl get ns "ws-$1" > /dev/null 2>&1 ; return $? ; fi
      [ -n "${root}" ] || return 1 ;
      case "${1:-}" in -j|--json-output)
        local up=stopped ; [ "$(rt_kubectl -n "${ns}" get deploy web -o jsonpath='{.status.availableReplicas}' 2>/dev/null)" -ge 1 ] 2>/dev/null && up=running ;
        rt_describe_json "${ns#ws-}" "${up}" "$(rt_url "${root}")" kubernetes ; return 0 ;;
      esac
      echo "${ns#ws-} on kubernetes ($(rt_kctx)): $(rt_url "${root}")" ; rt_kubectl -n "${ns}" get pods ;;
    delete)
      if [ -n "${root}" ] ; then rt_kubectl delete ns "${ns}" --wait=true ;
      else local n ; for n in "$@" ; do case "${n}" in -*) ;; *) rt_kubectl delete ns "ws-${n}" --ignore-not-found --wait=true 2>/dev/null ;; esac ; done ; fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then kx web runuser -u www-data -- env COMPOSER_HOME=/tmp/composer bash -c "cd '${workdir}' && $(rt_create_project_cmd "$@")" ;
      else kx web runuser -u www-data -- env COMPOSER_HOME=/tmp/composer bash -c "cd '${workdir}' && composer $(printf '%q ' "$@")" ; fi ;;
    drush) kx web runuser -u www-data -- bash -c "cd /var/www/html && $(rt_bin_dir "${root}")/drush $(printf '%q ' "$@")" ;;
    php|wp) kx web runuser -u www-data -- bash -c "cd '${workdir}' && ${verb} $(printf '%q ' "$@")" ;;
    npm|npx|node|yarn) rt_tests_run kubernetes "${root}" "${PWD}" "${verb} $(printf '%q ' "$@")" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; --) shift ; break ;; *) break ;; esac ; done
      local line ; line="$(rt_exec_line "$@")" ;
      if [ "${svc}" = tests ] ; then rt_tests_run kubernetes "${root}" "${PWD}" "${line}" ; return $? ; fi
      if [ "${svc}" = web ] ; then kx web runuser -u www-data -- bash -c "cd '${workdir}' && ${line}" ; else kx "${svc}" bash -c "${line}" ; fi ;;
    ssh) rt_kubectl -n "${ns}" exec -it deploy/web -c web -- runuser -u www-data -- bash ;;
    mysql|psql|export-db|import-db)
      # The project's database decides the client (#841): MariaDB, PostgreSQL, or none.
      local dbase ; dbase="$(rt_meta database "${root}")" ;
      dbx() { kx db "$@" ; } ;
      case "${dbase}" in
        none) echo "This project has no database." >&2 ; return 1 ;;
        postgres:*) case "${verb}" in
          mysql) echo "The database of this project is PostgreSQL: ddev psql." >&2 ; return 1 ;;
          psql) dbx psql -U db -d db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then dbx pg_dump -U db --no-owner --no-privileges db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else dbx pg_dump -U db --no-owner --no-privileges db | gzip ; fi ;;
          import-db) rt_pg_import "$(rt_file_arg "$@")" dbx ;;
        esac ;;
        *) case "${verb}" in
          psql) echo "The database of this project is MariaDB: ddev mysql." >&2 ; return 1 ;;
          mysql) dbx mariadb -udb -pdb db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then dbx mariadb-dump -udb -pdb db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else dbx mariadb-dump -udb -pdb db | gzip ; fi ;;
          import-db)
            local file ; file="$(rt_file_arg "$@")" ;
            [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
            case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | dbx mariadb -udb -pdb db ;;
        esac ;;
      esac ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) rt_kubectl -n "${ns}" logs deploy/web -c web --tail "${LOG_LINES:-200}" ;;
    version|--version|-v) echo "the Webship Workspace's kubernetes runtime (no DDEV), context $(rt_kctx)" ;;
    *) echo "The kubernetes runtime cannot run 'ddev ${verb}' (webship/workspace#694)." >&2 ; return 1 ;;
  esac
}

# --- Lando (#729) -----------------------------------------------------------------------------------------------
# The same stack in a .lando.yml: Lando's lamp recipe (Apache, PHP, MariaDB) with the docroot, PHP and MariaDB a build
# asks for, Mailpit, and the x-webship block. The site answers on a port of this machine (127.0.0.1), as on Docker
# Compose, and so does its mailbox. Every call the Workspace makes runs with LANDO_PROXY=OFF: Lando's proxy would ask
# for ports 80 and 443, which DDEV's router holds, and the site needs none of it. LANDO_CHANNEL=none keeps Lando's
# update notices out of what a build reads. Nothing in ~/.lando is changed.
#
# A Landofile of the project's own (one the Workspace did not write) runs too, through Lando's own commands: its
# services are found by their names (appserver, database), its database credentials from the service itself.

function rt_lando_cli() { LANDO_PROXY=OFF LANDO_CHANNEL=none LANDO_NO_UPDATE_NOTIFY=1 "${WORKSPACE_LANDO_BIN:-lando}" "$@" ; }
function rt_lando_bin() { command -v "${WORKSPACE_LANDO_BIN:-lando}" > /dev/null 2>&1 || [ -x "${HOME}/.local/bin/lando" ] ; }

# Lando's name of an app: lower case, without - _ and . (Lando's own rule), as its containers are named.
function rt_lando_app() { local n ; n="$(rt_name "$1")" ; n="${n,,}" ; echo "${n//[^a-z0-9]/}" ; }

# Writes .lando.yml (and the Apache file that lets the site reach itself at its own address) for a project.
function rt_lando_write() {
  local root="$1" name="$2" type="$3" docroot="$4" php="$5" db="$6" port="$7" platform="${8:-}" mail_port="${9:-}" daemons="${10:-}" ;
  local webroot="/app${docroot:+/${docroot}}" mail_ports="" events="" ;
  # The mailbox, on this machine only: the tests of the site read the mail it sent there (MAIL_URL).
  [ -n "${mail_port}" ] && mail_ports=$'\n    # The mailbox, on this machine only (MAIL_URL).\n    overrides:\n      ports:\n        - "127.0.0.1:'"${mail_port}"$':80"' ;
  mkdir -p "${root}/.webship/runtime" ;
  # Apache also answers on the site's own port inside the container, so http://127.0.0.1:<port> is the site from
  # there too (a platform's scheduled tasks and its own checks call it): as the php stack's Dockerfile does.
  cat > "${root}/.webship/runtime/lando-port.conf" <<APACHE
# Written by the Webship Workspace's lando runtime (webship/workspace#729): the site on its own port inside the container.
Listen ${port}
<VirtualHost *:${port}>
  DocumentRoot ${webroot}
  <Directory ${webroot}>
    Options FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
APACHE
  # The database clients of the web container skip TLS: in /usr/local/sbin, before Lando's own in /usr/local/bin.
  cat > "${root}/.webship/runtime/lando-clients.sh" <<'SH'
# Written by the Webship Workspace's lando runtime (webship/workspace#729), run as root when the app is built.
for b in mysql mariadb mysqldump mariadb-dump ; do
  case "${b}" in *dump) t=/usr/bin/mariadb-dump ;; *) t=/usr/bin/mariadb ;; esac
  [ -x "${t}" ] || continue
  printf '#!/bin/sh\nexec %s "$@" --skip-ssl\n' "${t}" > "/usr/local/sbin/${b}"
  chmod +x "/usr/local/sbin/${b}"
done
SH
  # The tasks beside the web server (rt_daemon): in the appserver, after each start, as the web server's user. A lock
  # keeps them to one set when Lando starts an app that already runs.
  if [ -n "${daemons}" ] ; then
    cat > "${root}/.webship/runtime/lando-daemons.sh" <<'SH'
# Written by the Webship Workspace's lando runtime: the project's tasks (rt_daemon), kept running beside the web server.
# Lando runs it after each start (events: post-start); the lock, held while they run, keeps them to one set.
exec 9> /tmp/webship-daemons.lock
flock -n 9 || exit 0
run='' ; [ "$(id -u)" = 0 ] && run='runuser -u www-data --'
nohup setsid ${run} bash -c 'for f in /app/.webship/daemons/*.sh ; do [ -f "$f" ] && bash "$f" & done ; wait' < /dev/null > /tmp/webship-daemons.log 2>&1 &
SH
    events=$'
events:
  post-start:
    # The tasks beside the web server (rt_daemon).
    - appserver: bash /app/.webship/runtime/lando-daemons.sh' ;
  fi
  cat > "${root}/.lando.yml" <<YAML
# Written by the Webship Workspace (its lando runtime, webship/workspace#729). Run it with: lando start
name: ${name}
x-webship:${platform:+
  platform: ${platform}}
  runtime: lando
  stack: php
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  port: ${port}${mail_port:+
  mail_port: ${mail_port}}${daemons:+
  daemons: ${daemons}}
recipe: lamp
config:
  webroot: "${docroot:-.}"
  php: "${php}"
  database: mariadb:${db}
  via: apache
  xdebug: false
services:
  appserver:
    build_as_root:
      # WP-CLI, as the php stack has it.
      - command -v wp > /dev/null || { curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x /usr/local/bin/wp ; }
      # The image's MariaDB 11 client asks for TLS, which the database does not have (Drush: "ERROR 2026: SSL is
      # required"): the clients skip it, as in the php stack (.webship/runtime/lando-clients.sh).
      - bash /app/.webship/runtime/lando-clients.sh
    overrides:
      environment:
        WEBSHIP_RUNTIME: lando
        WEBSHIP_PORT: "${port}"
        # The project's own PHP settings (rt_php_ini), after the stack's: the leading ':' keeps PHP's own folder.
        PHP_INI_SCAN_DIR: ":/app/.webship/php"
        # Lando's Apache passes BACKDROP_SETTINGS (its Backdrop recipe's database settings) to every site, and the
        # text as it is written when the variable is not set, on which Backdrop CMS stops: no settings to add.
        BACKDROP_SETTINGS: "{}"
      volumes:
        - ./.webship/runtime/lando-port.conf:/etc/apache2/conf-enabled/webship-port.conf
      ports:
        - "127.0.0.1:${port}:80"
  database:
    creds:
      user: db
      password: db
      database: db
    # Also on the host db, as on the other runtimes: a platform plugin writes its config with db/db/db on db.
    overrides:
      networks:
        default:
          aliases:
            - db
  mailpit:
    type: mailpit
    mailFrom:
      - appserver${mail_ports}${events}
YAML
}

# A generic stack on Lando (#841): no recipe. appserver runs the application's server, from the stack's own image
# (.webship/runtime: the language's image and what the application adds), start.sh first (#850). The database is
# PostgreSQL as a service of the official image, as on the other runtimes, or Lando's own MariaDB, on the host db
# either way, with db/db/db; Lando's Mailpit answers on the host mail, where the stack's sendmail sends.
function rt_lando_generic_write() {
  local root="$1" name="$2" type="$3" docroot="$4" php="$5" db="$6" port="$7" platform="${8:-}" mail_port="${9:-}" ;
  local lang="${RT_STACK_LANG:-}" lang_version="${RT_STACK_VERSION:-}" serve_port="${RT_SERVE_PORT:-}" ;
  local db_wait="${RT_DB_WAIT:-300}" serve_grace="${RT_SERVE_GRACE:-1800}" app stack_lines="" database="" mail_ports="" ;
  [[ "${db_wait}" =~ ^[0-9]+$ ]] || db_wait=300 ; [[ "${serve_grace}" =~ ^[0-9]+$ ]] || serve_grace=1800 ;
  app="${name,,}" ; app="${app//[^a-z0-9]/}" ;
  [ -n "${lang}" ] && stack_lines="${stack_lines}"$'\n  language: '"${lang}" ;
  [ -n "${lang_version}" ] && stack_lines="${stack_lines}"$'\n  language_version: "'"${lang_version}"'"' ;
  [ -n "${serve_port}" ] && stack_lines="${stack_lines}"$'\n  serve_port: '"${serve_port}" ;
  stack_lines="${stack_lines}"$'\n  db_wait: '"${db_wait}"$'\n  serve_grace: '"${serve_grace}" ;
  rt_generic_runtime "${root}" "${db}" ;
  case "${db}" in
    none) ;;
    postgres:*)
      local v="${db#postgres:}" data=/var/lib/postgresql/data ;
      [ "${v%%.*}" -ge 18 ] 2>/dev/null && data=/var/lib/postgresql ;
      database="
  database:
    # PostgreSQL ${v}, the official image as on the other runtimes (not Lando's own postgres type): db/db/db.
    type: compose
    services:
      image: postgres:${v}
      command: docker-entrypoint.sh postgres
      environment:
        POSTGRES_DB: db
        POSTGRES_USER: db
        POSTGRES_PASSWORD: db
      volumes:
        - db:${data}
      networks:
        default:
          aliases:
            - db
    volumes:
      db:" ;;
    *)
      database="
  database:
    type: mariadb:${db}
    creds:
      user: db
      password: db
      database: db
    overrides:
      networks:
        default:
          aliases:
            - db" ;;
  esac
  [ -n "${mail_port}" ] && mail_ports=$'\n      # The mailbox, on this machine only (MAIL_URL).\n      ports:\n        - "127.0.0.1:'"${mail_port}"$':80"' ;
  cat > "${root}/.lando.yml" <<YAML
# Written by the Webship Workspace (its lando runtime, webship/workspace#729 and #841). Run it with: lando start
name: ${name}
x-webship:${platform:+
  platform: ${platform}}
  runtime: lando
  stack: generic${stack_lines}
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  port: ${port}${mail_port:+
  mail_port: ${mail_port}}
services:
  appserver:
    # The application's own server (rt_serve), as the host user, from the app's root, once its database takes
    # connections (start.sh, #850).
    type: lando
    services:
      build:
        context: ./.webship/runtime
        args:
          BASE_IMAGE: "$(rt_stack_image "${lang}" "${lang_version}")"
          UID: "$(id -u)"
          GID: "$(id -g)"
      image: webship-${app}-web
      command: runuser -u www-data -- bash /app/.webship/runtime/start.sh
      environment:
        WEBSHIP_RUNTIME: lando
        WEBSHIP_PORT: "${port}"
        WEBSHIP_DB_WAIT: "${db_wait}"
      ports:
        - "127.0.0.1:${port}:${serve_port:-8000}"${database}
  mailpit:
    type: mailpit
    overrides:${mail_ports}
      # The stack's sendmail sends to the host mail, as on the other runtimes.
      networks:
        default:
          aliases:
            - mail
YAML
}

# The containers of a Lando app, by the label Lando gives them: its folder.
function rt_lando_containers() { docker ps ${2:+-a} -q --filter "label=io.lando.root=$1" 2> /dev/null ; }

# A command in a service of the app. -i keeps what is piped in.
function rt_lando_x() {
  local root="$1" svc="$2" ; shift 2 ;
  ( cd "${root}" && rt_lando_cli exec "${svc}" -- "$@" ) ;
}

# Waits for the app's containers to run and its database to answer, up to WORKSPACE_LANDO_WAIT seconds (180).
function rt_lando_wait_db() {
  local root="$1" i ;
  for (( i = 0 ; i < ${WORKSPACE_LANDO_WAIT:-180} ; i += 5 )) ; do
    if [ -n "$(rt_lando_containers "${root}")" ] && [ -z "$(docker ps -a -q --filter "label=io.lando.root=${root}" --filter status=exited 2> /dev/null)" ] \
       && rt_lando_x "${root}" database bash -c 'mysql -u"${MARIADB_USER:-db}" -p"${MARIADB_PASSWORD:-db}" -e "SELECT 1"' > /dev/null 2>&1 ; then
      return 0 ;
    fi
    sleep 5 ;
  done
  return 1 ;
}

function rt_lando() {
  local verb="${1:-}" ; shift || true ;
  local found root="" rel="" ;
  found="$(rt_find_project)" && [ "${found%% *}" = lando ] && root="${found#* }" ;
  [ -n "${root}" ] && rel="${PWD#${root}}" ;
  local workdir="/app${rel}" ;
  rt_lando_bin || { echo "The lando runtime needs Lando (https://docs.lando.dev/install/): no lando on PATH or in ~/.local/bin." >&2 ; return 1 ; } ;
  case ":${PATH}:" in *":${HOME}/.local/bin:"*) ;; *) [ -d "${HOME}/.local/bin" ] && PATH="${PATH}:${HOME}/.local/bin" ;; esac
  # The database of the app: the Workspace's (db), or a Landofile's own, read from the service.
  # The clients by MariaDB's own names where the image has them: from 11.x on, an image may have no mysql or mysqldump.
  local dbcmd='"$(command -v mariadb || echo mysql)" -u"${MARIADB_USER:-${MYSQL_USER:-db}}" -p"${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-db}}" "${MARIADB_DATABASE:-${MYSQL_DATABASE:-db}}"' ;
  local dumpcmd='"$(command -v mariadb-dump || echo mysqldump)" -u"${MARIADB_USER:-${MYSQL_USER:-db}}" -p"${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-db}}" "${MARIADB_DATABASE:-${MYSQL_DATABASE:-db}}"' ;
  case "${verb}" in
    config)
      [ "${1:-}" = global ] && return 0 ;
      root="${root:-$PWD}" ;
      if [ -f "${root}/.lando.yml" ] && ! grep -q '^x-webship:' "${root}/.lando.yml" ; then
        echo "${root}/.lando.yml is the project's own: the Workspace leaves it as it is." ; return 0 ;
      fi
      local name type docroot php db port platform mail_port daemons a stack="" ;
      local RT_STACK_LANG RT_STACK_VERSION RT_SERVE_PORT RT_DB_WAIT RT_SERVE_GRACE ;
      if [ -f "${root}/.lando.yml" ] ; then
        name="$(rt_name "${root}")" ; type="$(rt_meta type "${root}")" ; docroot="$(rt_meta docroot "${root}")" ;
        php="$(rt_meta php "${root}")" ; db="$(rt_meta database "${root}")" ; port="$(rt_meta port "${root}")" ;
        platform="$(rt_meta platform "${root}")" ; mail_port="$(rt_meta mail_port "${root}")" ; daemons="$(rt_meta daemons "${root}")" ;
        # A generic stack's language, server, database wait and grace (#841, #850) stay when the file is written again.
        stack="$(rt_meta stack "${root}")" ; RT_STACK_LANG="$(rt_meta language "${root}")" ; RT_STACK_VERSION="$(rt_meta language_version "${root}")" ;
        RT_SERVE_PORT="$(rt_meta serve_port "${root}")" ; RT_DB_WAIT="$(rt_meta db_wait "${root}")" ; RT_SERVE_GRACE="$(rt_meta serve_grace "${root}")" ;
      fi
      RT_DB_WAIT="${WEBSHIP_DB_WAIT:-${RT_DB_WAIT}}" ; RT_SERVE_GRACE="${WEBSHIP_SERVE_GRACE:-${RT_SERVE_GRACE}}" ;
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          # PostgreSQL by its name and version, which the PostgreSQL plugin reads (#841); MariaDB as its version.
          --php-version=*) php="${a#*=}" ;; --database=postgres:*) db="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
          --omit-containers=*db*) db=none ;;
          --webserver-type=generic) stack=generic ;; --webserver-type=*) stack=php ;;
        esac
      done
      if [ "${stack}" = generic ] ; then
        RT_STACK_LANG="${RT_STACK_LANG}" RT_STACK_VERSION="${RT_STACK_VERSION}" RT_SERVE_PORT="${RT_SERVE_PORT}" RT_DB_WAIT="${RT_DB_WAIT}" RT_SERVE_GRACE="${RT_SERVE_GRACE}" \
          rt_lando_generic_write "${root}" "${name:-$(basename "${root}")}" "${type:-generic}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" "${platform}" "${mail_port:-$(rt_free_port)}" ;
        echo "Wrote .lando.yml for lando (generic, $(case "${db:-10.11}" in none) echo 'no database' ;; postgres:*) echo "PostgreSQL ${db#postgres:}" ;; *) echo "MariaDB ${db:-10.11}" ;; esac)): $(rt_url "${root}")" ;
        return 0 ;
      fi
      # The php stack has MariaDB: PostgreSQL there is a generic stack's, so far (#841).
      case "${db}" in postgres:*|none) echo "Lando's php stack has MariaDB: ${db} is a generic stack's (--webserver-type=generic), so far (webship/workspace#841)." >&2 ; return 1 ;; esac
      rt_lando_write "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" "${platform}" "${mail_port:-$(rt_free_port)}" "${daemons}" ;
      echo "Wrote .lando.yml for lando (${type:-php}, PHP ${php:-8.3}, MariaDB ${db:-10.11}): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No lando project here." >&2 ; return 1 ; } ;
      # A Landofile the Workspace wrote again (a new docroot, PHP or database) is applied with a rebuild: Lando's
      # start keeps the containers as they were made.
      local landofile_sum ; landofile_sum="$(cat "${root}/.lando.yml" "${root}/.webship/runtime/lando-port.conf" "${root}/.webship/runtime/lando-clients.sh" 2> /dev/null | md5sum | cut -c1-32)" ;
      # A generic stack's image (its Dockerfile, with what the application adds) and its start are its own (#841).
      [ "$(rt_meta stack "${root}")" = generic ] && landofile_sum="$(cat "${root}/.lando.yml" "${root}/.webship/runtime/Dockerfile" "${root}/.webship/runtime/start.sh" 2> /dev/null | md5sum | cut -c1-32)" ;
      local rc=0 ;
      if [ -n "$(rt_lando_containers "${root}" all)" ] && [ "$(cat "${root}/.webship/runtime/lando.sum" 2> /dev/null)" != "${landofile_sum}" ] && grep -q '^x-webship:' "${root}/.lando.yml" ; then
        ( cd "${root}" && rt_lando_cli rebuild -y ) || rc=$? ;
      elif [ "${verb}" = restart ] ; then ( cd "${root}" && rt_lando_cli restart ) || rc=$? ;
      else ( cd "${root}" && rt_lando_cli start ) || rc=$? ; fi
      # A database made for the first time can take longer than Lando's healthcheck waits for (found on a real
      # build: "The service database failed its healthcheck" with everything up a minute later). Lando then
      # answers 1 though the app runs: the database is asked itself, for up to three minutes, before that counts.
      if [ "${rc}" -ne 0 ] ; then
        rt_lando_wait_db "${root}" || return "${rc}" ;
        echo "(lando said ${rc}, and the app is up: its database answers now)" ;
      fi
      [ -d "${root}/.webship/runtime" ] && echo "${landofile_sum}" > "${root}/.webship/runtime/lando.sum" ;
      case "$(rt_meta type "${root}")" in drupal*) rt_drupal_settings "${root}" database ;; esac ;
      echo "Running on lando: $(rt_url "${root}")" ;;
    stop) ( cd "${root}" && rt_lando_cli stop ) ;;
    poweroff|list|add-on|get|snapshot|xdebug|mutagen|auth|share|hostname|debug|self-upgrade) echo "(lando: 'ddev ${verb}' has nothing to do here)" ;;
    describe)
      if [ -n "${1:-}" ] && [ -z "${root}" ] ; then
        [ -n "$(docker ps -a -q --filter "label=com.docker.compose.project=$(n="${1,,}" ; echo "${n//[^a-z0-9]/}")" --filter label=io.lando.container=TRUE 2>/dev/null)" ] ; return $? ;
      fi
      [ -n "${root}" ] || return 1 ;
      case "${1:-}" in -j|--json-output)
        local up=stopped ; [ -n "$(rt_lando_containers "${root}")" ] && up=running ;
        rt_describe_json "$(rt_name "${root}")" "${up}" "$(rt_url "${root}")" lando ; return 0 ;;
      esac
      echo "$(rt_name "${root}") on lando: $(rt_url "${root}")" ; ( cd "${root}" && rt_lando_cli info ) ;;
    delete)
      if [ -n "${root}" ] ; then ( cd "${root}" && rt_lando_cli destroy -y ) ;
      else
        # An app whose folder is gone (a rebuild of the same name): its containers and volumes, by Lando's name.
        local n app ids ; for n in "$@" ; do case "${n}" in -*) ;; *)
          app="${n,,}" ; app="${app//[^a-z0-9]/}" ;
          ids="$(docker ps -a -q --filter "label=com.docker.compose.project=${app}" --filter label=io.lando.container=TRUE 2>/dev/null)" ;
          [ -n "${ids}" ] || continue ;
          echo "${ids}" | xargs -r docker rm -f > /dev/null 2>&1 ;
          docker volume ls -q --filter "label=com.docker.compose.project=${app}" 2>/dev/null | xargs -r docker volume rm -f > /dev/null 2>&1 ;;
        esac ; done
      fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then rt_lando_x "${root}" appserver bash -c "cd '${workdir}' && $(rt_create_project_cmd "$@")" ;
      else rt_lando_x "${root}" appserver bash -c "cd '${workdir}' && composer $(printf '%q ' "$@")" ; fi ;;
    drush) rt_lando_x "${root}" appserver bash -c "cd /app && $(rt_bin_dir "${root}")/drush $(printf '%q ' "$@")" ;;
    php|wp) rt_lando_x "${root}" appserver bash -c "cd '${workdir}' && ${verb} $(printf '%q ' "$@")" ;;
    npm|npx|node|yarn) rt_tests_run lando "${root}" "${PWD}" "${verb} $(printf '%q ' "$@")" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; --) shift ; break ;; *) break ;; esac ; done
      local line ; line="$(rt_exec_line "$@")" ;
      if [ "${svc}" = tests ] ; then rt_tests_run lando "${root}" "${PWD}" "${line}" ; return $? ; fi
      # DDEV's service names are Lando's appserver and database.
      case "${svc}" in web) svc=appserver ;; db) svc=database ;; mail) svc=mailpit ;; esac ;
      if [ "${svc}" = appserver ] && [ "$(rt_meta stack "${root}")" = generic ] ; then
        # A generic stack's commands run as www-data, the host user, as its server does (#841).
        ( cd "${root}" && rt_lando_cli exec appserver --user www-data -- bash -c "cd '${workdir}' && ${line}" ) ;
      elif [ "${svc}" = appserver ] ; then rt_lando_x "${root}" appserver bash -c "cd '${workdir}' && ${line}" ;
      else rt_lando_x "${root}" "${svc}" bash -c "${line}" ; fi ;;
    ssh)
      if [ -t 0 ] ; then ( cd "${root}" && rt_lando_cli ssh ) ;
      else rt_lando_x "${root}" appserver bash ; fi ;;
    psql|mysql|export-db|import-db)
      # The project's database decides the client (#841): PostgreSQL (a generic stack's), MariaDB as before, or none.
      local dbase ; dbase="$(rt_meta database "${root}")" ;
      ldbx() { rt_lando_x "${root}" database "$@" ; } ;
      case "${dbase}" in
        none) echo "This project has no database." >&2 ; return 1 ;;
        postgres:*) case "${verb}" in
          mysql) echo "The database of this project is PostgreSQL: ddev psql." >&2 ; return 1 ;;
          psql) ldbx psql -U db -d db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then ldbx pg_dump -U db --no-owner --no-privileges db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else ldbx pg_dump -U db --no-owner --no-privileges db | gzip ; fi ;;
          import-db) rt_pg_import "$(rt_file_arg "$@")" ldbx ;;
        esac ;;
        *) case "${verb}" in
          psql) echo "The database of this project is MariaDB: ddev mysql." >&2 ; return 1 ;;
          mysql) rt_lando_x "${root}" database bash -c "${dbcmd} $(printf '%q ' "$@")" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then rt_lando_x "${root}" database bash -c "${dumpcmd}" | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else rt_lando_x "${root}" database bash -c "${dumpcmd}" | gzip ; fi ;;
          import-db)
            local file ; file="$(rt_file_arg "$@")" ;
            [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
            case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | rt_lando_x "${root}" database bash -c "${dbcmd}" ;;
        esac ;;
      esac ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) ( cd "${root}" && rt_lando_cli logs -s appserver ) | tail -n "${LOG_LINES:-200}" ;;
    version|--version|-v) echo "the Webship Workspace's lando runtime (no DDEV), lando $(rt_lando_cli version 2>/dev/null)" ;;
    *) echo "The lando runtime cannot run 'ddev ${verb}' (webship/workspace#729)." >&2 ; return 1 ;;
  esac
}

# --- Docksal (#730) ---------------------------------------------------------------------------------------------
# The same stack in .docksal/: docksal.env picks Docksal's default stack (Apache in web, PHP in cli, MariaDB in db)
# with the docroot, PHP and MariaDB a build asks for and the database db/db/db; docksal.yml carries the x-webship block
# and adds Docksal's mail service (Mailpit). The site answers at http://<name>.docksal.site through Docksal's own
# proxy, its mailbox at http://mail.<name>.docksal.site. Starting, stopping and removing go through `fin`; a command
# in a container goes through `docker exec -i` on the project's container, because `fin exec` hands a command no
# stdin (an import, `mysql < file`). Nothing in ~/.docksal is changed.

function rt_fin() { "${WORKSPACE_FIN_BIN:-fin}" "$@" ; }

# Docksal's name of a project (its compose project): the Workspace sets it in docksal.env, else Docksal's own rule.
function rt_docksal_project() {
  local n ; n="$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$1/.docksal/docksal.env" 2> /dev/null | head -1 | tr -d "\"'")" ;
  [ -n "${n}" ] || { n="$(basename "$1")" ; n="${n,,}" ; } ;
  echo "${n//[^-_a-z0-9]/}" ;
}

# The project's host name: VIRTUAL_HOST of docksal.env, else Docksal's own (<name>.docksal.site).
function rt_docksal_host() {
  local h ; h="$(sed -n 's/^VIRTUAL_HOST=//p' "$1/.docksal/docksal.env" 2> /dev/null | head -1 | tr -d "\"'")" ;
  [ -n "${h}" ] || { h="$(rt_docksal_project "$1")" ; h="${h//_/-}.docksal.site" ; } ;
  echo "${h}" ;
}

# Writes .docksal/docksal.env and .docksal/docksal.yml for a project.
# The release of Docksal's MariaDB image for a version: 11.x is only in 1.5 (there is no docksal/mariadb:11.4-1.4).
function rt_docksal_db_tag() { case "$1" in 11.*) echo 1.5 ;; *) echo 1.4 ;; esac ; }

function rt_docksal_write() {
  local root="$1" name="$2" type="$3" docroot="$4" php="$5" db="$6" platform="${7:-}" daemons="${8:-}" ;
  local safe="${name,,}" ; safe="${safe//_/-}" ; safe="${safe//[^-a-z0-9]/}" mount="" ;
  # The tasks beside the web server (rt_daemon): a program of cli's supervisor, where PHP runs, as the project's user.
  if [ -n "${daemons}" ] ; then
    mkdir -p "${root}/.webship/runtime" ;
    cat > "${root}/.webship/runtime/docksal-daemons.sh" <<'SH'
# Written by the Webship Workspace's docksal runtime: the project's tasks (rt_daemon), run by cli's supervisor.
for f in /var/www/.webship/daemons/*.sh ; do [ -f "$f" ] && bash "$f" & done
wait
SH
    # A script, not a command line: the supervisor reads " ;" as the start of a comment.
    cat > "${root}/.webship/runtime/docksal-daemons.conf" <<'CONF'
; Written by the Webship Workspace's docksal runtime: the project's tasks (rt_daemon), kept running beside the web
; server in cli, where PHP runs, as the project's user; its supervisor starts them again when they stop.
[program:webship-daemons]
command = runuser -u docker -- bash /var/www/.webship/runtime/docksal-daemons.sh
directory = /var/www
autorestart = true
stdout_logfile = /var/log/supervisor/webship-daemons-stdout
stderr_logfile = /var/log/supervisor/webship-daemons-stderr
CONF
    mount=$'
      # The tasks beside the web server (rt_daemon), a program of its supervisor.
      - ${PROJECT_ROOT}/.webship/runtime/docksal-daemons.conf:/etc/supervisor/conf.d/webship-daemons.conf:ro' ;
  fi
  # The project's own PHP settings (rt_php_ini) for the web server too: Docksal's pool sets some with php_value
  # (zz-php-fpm.conf: memory_limit, max_input_vars), which win over ini files. A pool file of the project's says them
  # again, read before Docksal's: php-fpm keeps the first value it reads for a setting.
  mkdir -p "${root}/.webship/runtime" ;
  rt_docksal_fpm "${root}" ;
  mkdir -p "${root}/.docksal" ;
  cat > "${root}/.docksal/docksal.env" <<ENV
# Written by the Webship Workspace (its docksal runtime, webship/workspace#730). Run it with: fin project start
DOCKSAL_STACK=default
COMPOSE_PROJECT_NAME=${safe}
VIRTUAL_HOST=${safe}.docksal.site
DOCROOT=${docroot:-.}
CLI_IMAGE=docksal/cli:php${php}-3.10
DB_IMAGE=docksal/mariadb:${db}-$(rt_docksal_db_tag "${db}")
MYSQL_ROOT_PASSWORD=root
MYSQL_USER=db
MYSQL_PASSWORD=db
MYSQL_DATABASE=db
ENV
  cat > "${root}/.docksal/docksal.yml" <<YAML
# Written by the Webship Workspace (its docksal runtime, webship/workspace#730), beside docksal.env.
x-webship:${platform:+
  platform: ${platform}}
  runtime: docksal
  name: ${name}
  stack: php
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  host: ${safe}.docksal.site${daemons:+
  daemons: ${daemons}}
services:
  cli:
    environment:
      - WEBSHIP_RUNTIME=docksal
      # The project's own PHP settings (rt_php_ini), after the stack's: the leading ':' keeps PHP's own folder.
      - PHP_INI_SCAN_DIR=:/var/www/.webship/php
    volumes:
      # The project's own PHP settings for the web server (rt_php_ini): read first, as php-fpm keeps the first value of each.
      - \${PROJECT_ROOT}/.webship/runtime/docksal-fpm.conf:/usr/local/etc/php-fpm.d/00-webship.conf:ro${mount}
  # Mailpit: PHP's mail goes there from cli, and its page is http://mail.${safe}.docksal.site (MAIL_URL).
  mail:
    extends:
      file: \${HOME}/.docksal/stacks/services.yml
      service: mail
YAML
}

# A generic stack on Docksal (#841), the way Docksal runs an app that serves itself (its node stack): cli is the stack's
# own image (.webship/runtime: the language's and what the application adds) and runs the application's server, start.sh
# first (#850), behind Docksal's proxy on its port. Docksal's proxy routes to a healthy container only: the stack's
# probe (#850) is cli's healthcheck, and passes before the server first answers, while a build makes the app. The
# database is PostgreSQL, the official image as on the other runtimes, or Docksal's MariaDB, on the host db, db/db/db.
function rt_docksal_generic_write() {
  local root="$1" name="$2" type="$3" docroot="$4" php="$5" db="$6" platform="${7:-}" ;
  local lang="${RT_STACK_LANG:-}" lang_version="${RT_STACK_VERSION:-}" serve_port="${RT_SERVE_PORT:-}" ;
  local db_wait="${RT_DB_WAIT:-300}" serve_grace="${RT_SERVE_GRACE:-1800}" stack_lines="" database="" volumes="" db_env="" ;
  [[ "${db_wait}" =~ ^[0-9]+$ ]] || db_wait=300 ; [[ "${serve_grace}" =~ ^[0-9]+$ ]] || serve_grace=1800 ;
  local safe="${name,,}" ; safe="${safe//_/-}" ; safe="${safe//[^-a-z0-9]/}" ;
  [ -n "${lang}" ] && stack_lines="${stack_lines}"$'\n  language: '"${lang}" ;
  [ -n "${lang_version}" ] && stack_lines="${stack_lines}"$'\n  language_version: "'"${lang_version}"'"' ;
  [ -n "${serve_port}" ] && stack_lines="${stack_lines}"$'\n  serve_port: '"${serve_port}" ;
  stack_lines="${stack_lines}"$'\n  db_wait: '"${db_wait}"$'\n  serve_grace: '"${serve_grace}" ;
  rt_generic_runtime "${root}" "${db}" ;
  case "${db}" in
    none) ;;
    postgres:*)
      local v="${db#postgres:}" data=/var/lib/postgresql/data ;
      [ "${v%%.*}" -ge 18 ] 2>/dev/null && data=/var/lib/postgresql ;
      database="
  # PostgreSQL ${v}, the official image as on the other runtimes: db/db/db. Docksal's containers are known by their
  # hostname, as its own services say theirs: without it db is not a name on the project's network.
  db:
    hostname: db
    image: postgres:${v}
    environment:
      - POSTGRES_DB=db
      - POSTGRES_USER=db
      - POSTGRES_PASSWORD=db
    volumes:
      - db:${data}
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U db -d db\"]
      interval: 5s
      timeout: 5s
      retries: 60"
      volumes=$'\nvolumes:\n  db:' ;;
    *)
      db_env="
DB_IMAGE=docksal/mariadb:${db}-$(rt_docksal_db_tag "${db}")
MYSQL_ROOT_PASSWORD=root
MYSQL_USER=db
MYSQL_PASSWORD=db
MYSQL_DATABASE=db"
      database="
  # Docksal's MariaDB, as the php stack has it: db/db/db.
  db:
    extends:
      file: \${HOME}/.docksal/stacks/services.yml
      service: db" ;;
  esac
  mkdir -p "${root}/.docksal" ;
  cat > "${root}/.docksal/docksal.env" <<ENV
# Written by the Webship Workspace (its docksal runtime, webship/workspace#730 and #841). Run it with: fin project start
DOCKSAL_STACK=node
COMPOSE_PROJECT_NAME=${safe}
VIRTUAL_HOST=${safe}.docksal.site
DOCROOT=${docroot:-.}${db_env}
ENV
  cat > "${root}/.docksal/docksal.yml" <<YAML
# Written by the Webship Workspace (its docksal runtime, webship/workspace#730 and #841), beside docksal.env.
x-webship:${platform:+
  platform: ${platform}}
  runtime: docksal
  name: ${name}
  stack: generic${stack_lines}
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  host: ${safe}.docksal.site
services:
  cli:
    # The application's own server (rt_serve), as the host user, from the project's root, once its database takes
    # connections (start.sh, #850), behind Docksal's proxy on its port.
    image: webship-${safe}-web
    build:
      context: \${PROJECT_ROOT}/.webship/runtime
      args:
        BASE_IMAGE: "$(rt_stack_image "${lang}" "${lang_version}")"
        UID: "$(id -u)"
        GID: "$(id -g)"
    command: ["runuser", "-u", "www-data", "--", "bash", "/var/www/.webship/runtime/start.sh"]
    environment:
      - WEBSHIP_RUNTIME=docksal
      - WEBSHIP_DB_WAIT=${db_wait}
      - WEBSHIP_SERVE_GRACE=${serve_grace}
    labels:
      - io.docksal.user=www-data
      - io.docksal.virtual-port=${serve_port:-8000}
    expose:
      - "${serve_port:-8000}"
    # Docksal's proxy routes to a healthy container only: the stack's probe (#850), which passes before the server
    # first answers.
    healthcheck:
      test: ["CMD", "bash", "/var/www/.webship/runtime/probe.sh", "${serve_port:-8000}"]
      interval: 5s
      timeout: 10s
      retries: 3${database}
  # Mailpit: the stack's sendmail sends to the host mail, and its page is http://mail.${safe}.docksal.site (MAIL_URL).
  mail:
    extends:
      file: \${HOME}/.docksal/stacks/services.yml
      service: mail${volumes}
YAML
}

# The pool file of a Docksal project: each `key = value` of its .webship/php/*.ini as php_value, read by php-fpm before
# Docksal's own pool settings (php-fpm keeps the first value of each), so the web server has the project's (rt_php_ini).
function rt_docksal_fpm() {
  local root="$1" f line ;
  {
    echo "; Written by the Webship Workspace's docksal runtime: the project's own PHP settings (rt_php_ini, .webship/php/*.ini)" ;
    echo "; for the web server too, read before Docksal's pool settings: php-fpm keeps the first value it reads for each." ;
    echo "[www]" ;
    for f in "${root}"/.webship/php/*.ini ; do
      [ -f "${f}" ] || continue ;
      while IFS= read -r line || [ -n "${line}" ] ; do
        [[ "${line}" =~ ^[[:space:]]*([A-Za-z0-9_.]+)[[:space:]]*=[[:space:]]*(.*[^[:space:]])[[:space:]]*$ ]] || continue ;
        echo "php_value[${BASH_REMATCH[1]}] = ${BASH_REMATCH[2]}" ;
      done < "${f}" ;
    done
  } > "${root}/.webship/runtime/docksal-fpm.conf" ;
}

# The container of a service of the project, by the labels compose gives it (fin runs compose in .docksal/).
function rt_docksal_cid() {
  docker ps -q --filter "label=com.docker.compose.project.working_dir=$1/.docksal" --filter "label=com.docker.compose.service=$2" 2> /dev/null | head -1 ;
}

# A command in a service of the project: cli as Docksal's own user (yours), the others as their image has it.
function rt_docksal_x() {
  local root="$1" svc="$2" cid user=() ; shift 2 ;
  cid="$(rt_docksal_cid "${root}" "${svc}")" ;
  [ -n "${cid}" ] || { echo "The ${svc} container of $(rt_docksal_project "${root}") is not running: ddev start (fin project start) first." >&2 ; return 1 ; } ;
  # A generic stack's cli is the stack's own image: its user is www-data, the host user (#841).
  [ "${svc}" = cli ] && { if [ "$(rt_meta stack "${root}")" = generic ] ; then user=(-u www-data) ; else user=(-u docker) ; fi ; } ;
  docker exec -i "${user[@]}" "${cid}" "$@" ;
}

function rt_docksal() {
  local verb="${1:-}" ; shift || true ;
  local found root="" rel="" ;
  found="$(rt_find_project)" && [ "${found%% *}" = docksal ] && root="${found#* }" ;
  [ -n "${root}" ] && rel="${PWD#${root}}" ;
  local workdir="/var/www${rel}" ;
  command -v "${WORKSPACE_FIN_BIN:-fin}" > /dev/null 2>&1 || { echo "The docksal runtime needs Docksal (https://docs.docksal.io/getting-started/setup/): no fin on PATH." >&2 ; return 1 ; } ;
  # The clients by MariaDB's own names where the image has them: from 11.x on, an image may have no mysql or mysqldump.
  local dbcmd='"$(command -v mariadb || echo mysql)" -u"${MYSQL_USER:-user}" -p"${MYSQL_PASSWORD:-user}" "${MYSQL_DATABASE:-default}"' ;
  local dumpcmd='"$(command -v mariadb-dump || echo mysqldump)" -u"${MYSQL_USER:-user}" -p"${MYSQL_PASSWORD:-user}" "${MYSQL_DATABASE:-default}"' ;
  case "${verb}" in
    config)
      [ "${1:-}" = global ] && return 0 ;
      root="${root:-$PWD}" ;
      if [ -d "${root}/.docksal" ] && ! grep -q '^x-webship:' "${root}/.docksal/docksal.yml" 2> /dev/null ; then
        echo "${root}/.docksal/ is the project's own: the Workspace leaves it as it is." ; return 0 ;
      fi
      local name type docroot php db platform daemons a stack="" ;
      local RT_STACK_LANG RT_STACK_VERSION RT_SERVE_PORT RT_DB_WAIT RT_SERVE_GRACE ;
      if [ -f "${root}/.docksal/docksal.yml" ] ; then
        name="$(rt_name "${root}")" ; type="$(rt_meta type "${root}")" ; docroot="$(rt_meta docroot "${root}")" ;
        php="$(rt_meta php "${root}")" ; db="$(rt_meta database "${root}")" ; platform="$(rt_meta platform "${root}")" ;
        daemons="$(rt_meta daemons "${root}")" ;
        # A generic stack's language, server, database wait and grace (#841, #850) stay when the files are written again.
        stack="$(rt_meta stack "${root}")" ; RT_STACK_LANG="$(rt_meta language "${root}")" ; RT_STACK_VERSION="$(rt_meta language_version "${root}")" ;
        RT_SERVE_PORT="$(rt_meta serve_port "${root}")" ; RT_DB_WAIT="$(rt_meta db_wait "${root}")" ; RT_SERVE_GRACE="$(rt_meta serve_grace "${root}")" ;
      fi
      RT_DB_WAIT="${WEBSHIP_DB_WAIT:-${RT_DB_WAIT}}" ; RT_SERVE_GRACE="${WEBSHIP_SERVE_GRACE:-${RT_SERVE_GRACE}}" ;
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          # PostgreSQL by its name and version, which the PostgreSQL plugin reads (#841); MariaDB as its version.
          --php-version=*) php="${a#*=}" ;; --database=postgres:*) db="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
          --omit-containers=*db*) db=none ;;
          --webserver-type=generic) stack=generic ;; --webserver-type=*) stack=php ;;
        esac
      done
      if [ "${stack}" = generic ] ; then
        RT_STACK_LANG="${RT_STACK_LANG}" RT_STACK_VERSION="${RT_STACK_VERSION}" RT_SERVE_PORT="${RT_SERVE_PORT}" RT_DB_WAIT="${RT_DB_WAIT}" RT_SERVE_GRACE="${RT_SERVE_GRACE}" \
          rt_docksal_generic_write "${root}" "${name:-$(basename "${root}")}" "${type:-generic}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${platform}" ;
        echo "Wrote .docksal/ for docksal (generic, $(case "${db:-10.11}" in none) echo 'no database' ;; postgres:*) echo "PostgreSQL ${db#postgres:}" ;; *) echo "MariaDB ${db:-10.11}" ;; esac)): $(rt_url "${root}")" ;
        return 0 ;
      fi
      # The php stack has MariaDB: PostgreSQL there is a generic stack's, so far (#841).
      case "${db}" in postgres:*|none) echo "Docksal's php stack has MariaDB: ${db} is a generic stack's (--webserver-type=generic), so far (webship/workspace#841)." >&2 ; return 1 ;; esac
      rt_docksal_write "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${platform}" "${daemons}" ;
      echo "Wrote .docksal/ for docksal (${type:-php}, PHP ${php:-8.3}, MariaDB ${db:-10.11}): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No docksal project here." >&2 ; return 1 ; } ;
      # `fin project start` brings up what docksal.env and docksal.yml say now, so a project written again is
      # applied by a start; a restart stops first.
      [ "${verb}" = restart ] && { ( cd "${root}" && rt_fin project stop ) || return 1 ; } ;
      # A generic stack's image is built again first, from what the application adds now (rt_web_build); `fin project
      # start` would keep the image it made (#841).
      if [ "$(rt_meta stack "${root}")" = generic ] ; then ( cd "${root}" && rt_fin docker-compose build cli ) || return 1 ; fi
      ( cd "${root}" && rt_fin project start ) || return 1 ;
      case "$(rt_meta type "${root}")" in drupal*) rt_drupal_settings "${root}" db ;; esac ;
      echo "Running on docksal: $(rt_url "${root}")" ;;
    stop) ( cd "${root}" && rt_fin project stop ) ;;
    poweroff|list|add-on|get|snapshot|xdebug|mutagen|auth|share|hostname|debug|self-upgrade) echo "(docksal: 'ddev ${verb}' has nothing to do here)" ;;
    describe)
      if [ -n "${1:-}" ] && [ -z "${root}" ] ; then
        local n="${1,,}" ; n="${n//[^-_a-z0-9]/}" ;
        docker ps -a --filter "label=com.docker.compose.project=${n}" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | grep -q '/\.docksal$' ; return $? ;
      fi
      [ -n "${root}" ] || return 1 ;
      case "${1:-}" in -j|--json-output)
        local up=stopped ; [ -n "$(rt_docksal_cid "${root}" web)" ] && [ -n "$(rt_docksal_cid "${root}" cli)" ] && up=running ;
        # A generic stack has no web: its server runs in cli (#841).
        [ "$(rt_meta stack "${root}")" = generic ] && [ -n "$(rt_docksal_cid "${root}" cli)" ] && up=running ;
        rt_describe_json "$(rt_name "${root}")" "${up}" "$(rt_url "${root}")" docksal ; return 0 ;;
      esac
      echo "$(rt_name "${root}") on docksal: $(rt_url "${root}")" ; ( cd "${root}" && rt_fin project status ) ;;
    delete)
      if [ -n "${root}" ] ; then ( cd "${root}" && rt_fin project remove -f ) ;
      else
        # A project whose folder is gone (a rebuild of the same name): its containers and volumes, by its name.
        local n p ids ; for n in "$@" ; do case "${n}" in -*) ;; *)
          p="${n,,}" ; p="${p//[^-_a-z0-9]/}" ;
          docker ps -a --filter "label=com.docker.compose.project=${p}" --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | grep -q '/\.docksal$' || continue ;
          docker ps -a -q --filter "label=com.docker.compose.project=${p}" | xargs -r docker rm -f > /dev/null 2>&1 ;
          docker volume ls -q --filter "label=com.docker.compose.project=${p}" 2>/dev/null | xargs -r docker volume rm -f > /dev/null 2>&1 ;;
        esac ; done
      fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then rt_docksal_x "${root}" cli bash -c "cd '${workdir}' && $(rt_create_project_cmd "$@")" ;
      else rt_docksal_x "${root}" cli bash -c "cd '${workdir}' && composer $(printf '%q ' "$@")" ; fi ;;
    drush) rt_docksal_x "${root}" cli bash -c "cd /var/www && $(rt_bin_dir "${root}")/drush $(printf '%q ' "$@")" ;;
    php|wp) rt_docksal_x "${root}" cli bash -c "cd '${workdir}' && ${verb} $(printf '%q ' "$@")" ;;
    npm|npx|node|yarn) rt_tests_run docksal "${root}" "${PWD}" "${verb} $(printf '%q ' "$@")" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; --) shift ; break ;; *) break ;; esac ; done
      local line ; line="$(rt_exec_line "$@")" ;
      if [ "${svc}" = tests ] ; then rt_tests_run docksal "${root}" "${PWD}" "${line}" ; return $? ; fi
      # DDEV's web is where PHP runs: Docksal's cli (its web is Apache alone).
      [ "${svc}" = web ] && svc=cli ;
      if [ "${svc}" = cli ] ; then rt_docksal_x "${root}" cli bash -c "cd '${workdir}' && ${line}" ;
      else rt_docksal_x "${root}" "${svc}" bash -c "${line}" ; fi ;;
    ssh)
      if [ -t 0 ] ; then ( cd "${root}" && rt_fin bash ) ;
      else rt_docksal_x "${root}" cli bash ; fi ;;
    psql|mysql|export-db|import-db)
      # The project's database decides the client (#841): PostgreSQL (a generic stack's), MariaDB as before, or none.
      local dbase ; dbase="$(rt_meta database "${root}")" ;
      ddbx() { rt_docksal_x "${root}" db "$@" ; } ;
      case "${dbase}" in
        none) echo "This project has no database." >&2 ; return 1 ;;
        postgres:*) case "${verb}" in
          mysql) echo "The database of this project is PostgreSQL: ddev psql." >&2 ; return 1 ;;
          psql) ddbx psql -U db -d db "$@" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then ddbx pg_dump -U db --no-owner --no-privileges db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else ddbx pg_dump -U db --no-owner --no-privileges db | gzip ; fi ;;
          import-db) rt_pg_import "$(rt_file_arg "$@")" ddbx ;;
        esac ;;
        *) case "${verb}" in
          psql) echo "The database of this project is MariaDB: ddev mysql." >&2 ; return 1 ;;
          mysql) rt_docksal_x "${root}" db bash -c "${dbcmd} $(printf '%q ' "$@")" ;;
          export-db)
            local file ; file="$(rt_file_arg "$@")" ;
            if [ -n "${file}" ] ; then rt_docksal_x "${root}" db bash -c "${dumpcmd}" | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
            else rt_docksal_x "${root}" db bash -c "${dumpcmd}" | gzip ; fi ;;
          import-db)
            local file ; file="$(rt_file_arg "$@")" ;
            [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
            case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | rt_docksal_x "${root}" db bash -c "${dbcmd}" ;;
        esac ;;
      esac ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    # A generic stack's server runs in cli; the php stack's web server in web.
    logs) local cid ; if [ "$(rt_meta stack "${root}")" = generic ] ; then cid="$(rt_docksal_cid "${root}" cli)" ; else cid="$(rt_docksal_cid "${root}" web)" ; fi ; [ -n "${cid}" ] && docker logs --tail "${LOG_LINES:-200}" "${cid}" 2>&1 ;;
    version|--version|-v) echo "the Webship Workspace's docksal runtime (no DDEV), $(rt_fin version 2>/dev/null | tr '\n' ' ')" ;;
    *) echo "The docksal runtime cannot run 'ddev ${verb}' (webship/workspace#730)." >&2 ; return 1 ;;
  esac
}
