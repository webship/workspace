#!/usr/bin/env bash
# The container runtimes of the Webship Workspace (webship/workspace#694): DDEV by default, and Docker Compose,
# Podman, Kubernetes and Lando (#729) for a project built with --runtime docker|podman|kubernetes|lando.
#
# Every builder, tool and menu speaks DDEV's verbs (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`,
# `ddev exec`, `ddev export-db` ...). On a DDEV project those are DDEV itself, exactly as before. On another runtime
# the `ddev` function below gives each verb its meaning there, so the same builders and plugins work unchanged.
#
# A project's runtime is what it carries: an `x-webship:` block, written by the Workspace (in compose.yaml for Docker,
# Podman, or Kubernetes, whose manifests are written from it into k8s/; in .lando.yml for Lando), else .ddev/config.yaml
# (DDEV), else a .lando.yml of the project's own (Lando). A new build takes WORKSPACE_RUNTIME (a builder's --runtime),
# else settings.yml's container.runtime, else DDEV.

RT_STACKS="${WORKSPACE_ROOT:-}/core/config/runtimes"

# The files that can carry the x-webship block, in the order they are read.
RT_META_FILES=(compose.yaml .lando.yml)

# The file of a project that carries its x-webship block, relative to its root (compose.yaml when none does).
function rt_meta_file() {
  local f ;
  for f in "${RT_META_FILES[@]}" ; do
    [ -f "$1/${f}" ] && grep -q '^x-webship:' "$1/${f}" && { echo "${f}" ; return 0 ; } ;
  done
  echo compose.yaml ;
}

# The project's root and runtime, looking up from a folder: "<runtime> <root>", or nothing.
function rt_find_project() {
  local d="${1:-$PWD}" f ;
  d="$(cd "${d}" 2>/dev/null && pwd)" || return 1 ;
  while [ -n "${d}" ] && [ "${d}" != "/" ] ; do
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
    d="$(dirname "${d}")" ;
  done
  return 1 ;
}

# The runtime of a folder's project, or of a new build: ddev, docker, podman, kubernetes or lando.
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
  port="$(rt_meta mail_port "${root}")" ; [ -n "${port}" ] || return 0 ;
  # Lando: a port of this machine, as on Docker Compose.
  if [ "${rt}" = kubernetes ] ; then echo "http://$(rt_k8s_node_ip):${port}" ; else echo "http://127.0.0.1:${port}" ; fi
}

function ddev() {
  local rt ; rt="$(runtime_of)" ;
  case "${rt}" in
    ''|ddev) rt_ddev_config_args "$@" ; command ddev "${RT_DDEV_ARGS[@]}" ;;
    docker|podman) rt_compose "${rt}" "$@" ;;
    kubernetes) rt_k8s "$@" ;;
    lando) rt_lando "$@" ;;
    *) echo "The ${rt} runtime cannot run 'ddev $1' yet (webship/workspace#694)." >&2 ; return 1 ;;
  esac
}

# --- Docker Compose and Podman ---------------------------------------------------------------------------------

function rt_free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])' ; }

# docker compose, or podman compose, in the project.
function rt_dc() {
  local rt="$1" root="$2" ; shift 2 ;
  if [ "${rt}" = podman ] ; then ( cd "${root}" && podman compose "$@" ) ; else ( cd "${root}" && docker compose "$@" ) ; fi
}

# Writes compose.yaml and the stack's build folder for a project: what `ddev config` does for DDEV.
function rt_compose_write() {
  local rt="$1" root="$2" name="$3" type="$4" docroot="$5" php="$6" db="$7" port="$8" platform="${9:-}" mail_port="${10:-}" ;
  mkdir -p "${root}/.webship/runtime" ;
  cp "${RT_STACKS}/php/Dockerfile" "${root}/.webship/runtime/Dockerfile" ;
  # Rootless Podman maps a container's users into a range of their own: with keep-id the user of the web service is
  # the host user, so it can write the project folder it is given (found on a real Podman build, #694).
  local userns="" ;
  # The container still starts as root inside (user 0:0), so Apache can bind port 80; its workers are www-data.
  [ "${rt}" = podman ] && userns=$'    userns_mode: keep-id\n    user: "0:0"\n' ;
  # The mailbox, on this machine only: the tests of the site read the mail it sent there (MAIL_URL).
  local mail_ports="" ;
  [ -n "${mail_port}" ] && mail_ports=$'\n    # The mailbox, on this machine only (MAIL_URL).\n    ports:\n      - "127.0.0.1:'"${mail_port}"$':8025"' ;
  cat > "${root}/compose.yaml" <<YAML
# Written by the Webship Workspace (its ${rt} runtime, webship/workspace#694). Run it with: ${rt} compose up -d
name: ${name}
x-webship:${platform:+
  platform: ${platform}}
  runtime: ${rt}
  stack: php
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  port: ${port}${mail_port:+
  mail_port: ${mail_port}}
services:
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
      # The site's own port, also inside the container: it reaches itself at its address (the stack's Dockerfile).
      WEBSHIP_PORT: "${port}"
    volumes:
      - .:/var/www/html
    ports:
      - "127.0.0.1:${port}:80"
    depends_on:
      db:
        condition: service_healthy
  db:
    image: mariadb:${db}
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
  mail:
    image: axllent/mailpit${mail_ports}
volumes:
  db:
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

// The Webship Workspace's container runtime (Docker, Podman, Kubernetes, Lando): its database settings.
if (getenv('WEBSHIP_RUNTIME') && file_exists($app_root . '/' . $site_path . '/settings.webship-runtime.php')) {
  include $app_root . '/' . $site_path . '/settings.webship-runtime.php';
}
PHP
}

# `composer create-project <pkg> .` into a folder that already holds the runtime's files: as DDEV does, the project is
# created in a scratch folder in the container and copied in, so compose.yaml and .webship/ stay.
function rt_create_project_cmd() {
  local args=() a target_dot=0 ;
  for a in "$@" ; do if [ "${a}" = "." ] && [ ${target_dot} -eq 0 ] ; then args+=("/tmp/webship-create") ; target_dot=1 ; else args+=("${a}") ; fi ; done
  printf 'rm -rf /tmp/webship-create && composer %s && cp -a /tmp/webship-create/. "$PWD"/ && rm -rf /tmp/webship-create' "$(printf '%q ' "${args[@]}")" ;
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
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          --php-version=*) php="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
        esac
      done
      rt_compose_write "${rt}" "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" "${platform}" "${mail_port:-$(rt_free_port)}" ;
      echo "Wrote compose.yaml for ${rt} (${type:-php}, PHP ${php:-8.3}, MariaDB ${db:-10.11}): $(rt_url "${root}")" ;;
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
        [ -n "$( (docker compose -p "$1" ps -q 2>/dev/null || true) )" ] ; return $? ;
      fi
      [ -n "${root}" ] || return 1 ;
      case "${1:-}" in -j|--json-output)
        local up=stopped ; [ -n "$(rt_dc "${rt}" "${root}" ps --status running -q web 2>/dev/null)" ] && up=running ;
        rt_describe_json "$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" "${up}" "$(rt_url "${root}")" "${rt}" ; return 0 ;;
      esac
      echo "$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1) on ${rt}: $(rt_url "${root}")" ; rt_dc "${rt}" "${root}" ps ;;
    delete)
      if [ -n "${root}" ] ; then rt_dc "${rt}" "${root}" down -v --remove-orphans ;
      else local n ; for n in "$@" ; do case "${n}" in -*) ;; *) docker compose -p "${n}" down -v --remove-orphans 2>/dev/null ;; esac ; done ; fi ;;
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
    mysql) rt_dc "${rt}" "${root}" exec -T db mariadb -udb -pdb db "$@" ;;
    export-db)
      local file ; file="$(rt_file_arg "$@")" ;
      if [ -n "${file}" ] ; then rt_dc "${rt}" "${root}" exec -T db mariadb-dump -udb -pdb db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
      else rt_dc "${rt}" "${root}" exec -T db mariadb-dump -udb -pdb db | gzip ; fi ;;
    import-db)
      local file ; file="$(rt_file_arg "$@")" ;
      [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
      case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | rt_dc "${rt}" "${root}" exec -T db mariadb -udb -pdb db ;;
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

function rt_k8s_write() {
  local root="$1" name type docroot php db port mail_port ns image pull=Never ;
  name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ; docroot="$(rt_meta docroot "${root}")" ;
  db="$(rt_meta database "${root}")" ; port="$(rt_meta port "${root}")" ; mail_port="$(rt_meta mail_port "${root}")" ; ns="ws-${name}" ;
  image="$(rt_k8s_web_image "${root}")" ; [ "${image}" = "webship-${name}-web" ] || pull=IfNotPresent ;
  mkdir -p "${root}/k8s" ;
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
      containers:
        - name: db
          image: mariadb:${db}
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
      containers:
        - name: web
          image: ${image}
          imagePullPolicy: ${pull}
          env:
            - {name: APACHE_DOCUMENT_ROOT, value: /var/www/html${docroot:+/${docroot}}}
            - {name: WEBSHIP_RUNTIME, value: kubernetes}
          ports: [{containerPort: 80}]
          volumeMounts: [{name: code, mountPath: /var/www/html}]
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
  ports: [{port: 80, nodePort: ${port}}]
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
        docker build -q -t "webship-${name}-web" --build-arg PHP_VERSION="$(rt_meta php "${root}")" --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" "${root}/.webship/runtime" > /dev/null || return 1 ;
        case "$(rt_kctx)" in kind-*) kind load docker-image "webship-${name}-web" --name "${RT_KIND_CLUSTER}" > /dev/null || return 1 ;; esac ;
      fi
      rt_kubectl apply -k "${root}/k8s" > /dev/null || return 1 ;
      [ "${verb}" = restart ] && rt_kubectl -n "${ns}" rollout restart deploy/web > /dev/null ;
      rt_kubectl -n "${ns}" scale deploy --all --replicas=1 > /dev/null ;
      rt_kubectl -n "${ns}" rollout status deploy/db --timeout=900s > /dev/null && rt_kubectl -n "${ns}" rollout status deploy/web --timeout=900s > /dev/null || return 1 ;
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
    mysql) kx db mariadb -udb -pdb db "$@" ;;
    export-db)
      local file ; file="$(rt_file_arg "$@")" ;
      if [ -n "${file}" ] ; then kx db mariadb-dump -udb -pdb db | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
      else kx db mariadb-dump -udb -pdb db | gzip ; fi ;;
    import-db)
      local file ; file="$(rt_file_arg "$@")" ;
      [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
      case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | kx db mariadb -udb -pdb db ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) rt_kubectl -n "${ns}" logs deploy/web --tail "${LOG_LINES:-200}" ;;
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
  local root="$1" name="$2" type="$3" docroot="$4" php="$5" db="$6" port="$7" platform="${8:-}" mail_port="${9:-}" ;
  local webroot="/app${docroot:+/${docroot}}" mail_ports="" ;
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
  mail_port: ${mail_port}}
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
      - appserver${mail_ports}
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
  local dbcmd='mysql -u"${MARIADB_USER:-${MYSQL_USER:-db}}" -p"${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-db}}" "${MARIADB_DATABASE:-${MYSQL_DATABASE:-db}}"' ;
  local dumpcmd='mysqldump -u"${MARIADB_USER:-${MYSQL_USER:-db}}" -p"${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-db}}" "${MARIADB_DATABASE:-${MYSQL_DATABASE:-db}}"' ;
  case "${verb}" in
    config)
      [ "${1:-}" = global ] && return 0 ;
      root="${root:-$PWD}" ;
      if [ -f "${root}/.lando.yml" ] && ! grep -q '^x-webship:' "${root}/.lando.yml" ; then
        echo "${root}/.lando.yml is the project's own: the Workspace leaves it as it is." ; return 0 ;
      fi
      local name type docroot php db port platform mail_port a ;
      if [ -f "${root}/.lando.yml" ] ; then
        name="$(rt_name "${root}")" ; type="$(rt_meta type "${root}")" ; docroot="$(rt_meta docroot "${root}")" ;
        php="$(rt_meta php "${root}")" ; db="$(rt_meta database "${root}")" ; port="$(rt_meta port "${root}")" ;
        platform="$(rt_meta platform "${root}")" ; mail_port="$(rt_meta mail_port "${root}")" ;
      fi
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          --php-version=*) php="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
        esac
      done
      rt_lando_write "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" "${platform}" "${mail_port:-$(rt_free_port)}" ;
      echo "Wrote .lando.yml for lando (${type:-php}, PHP ${php:-8.3}, MariaDB ${db:-10.11}): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No lando project here." >&2 ; return 1 ; } ;
      # A Landofile the Workspace wrote again (a new docroot, PHP or database) is applied with a rebuild: Lando's
      # start keeps the containers as they were made.
      local landofile_sum ; landofile_sum="$(cat "${root}/.lando.yml" "${root}/.webship/runtime/lando-port.conf" "${root}/.webship/runtime/lando-clients.sh" 2> /dev/null | md5sum | cut -c1-32)" ;
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
      if [ "${svc}" = appserver ] ; then rt_lando_x "${root}" appserver bash -c "cd '${workdir}' && ${line}" ;
      else rt_lando_x "${root}" "${svc}" bash -c "${line}" ; fi ;;
    ssh)
      if [ -t 0 ] ; then ( cd "${root}" && rt_lando_cli ssh ) ;
      else rt_lando_x "${root}" appserver bash ; fi ;;
    mysql) rt_lando_x "${root}" database bash -c "${dbcmd} $(printf '%q ' "$@")" ;;
    export-db)
      local file ; file="$(rt_file_arg "$@")" ;
      if [ -n "${file}" ] ; then rt_lando_x "${root}" database bash -c "${dumpcmd}" | gzip > "${file}" ; [ "${PIPESTATUS[0]}" -eq 0 ] && rt_dump_has_content "${file}" ;
      else rt_lando_x "${root}" database bash -c "${dumpcmd}" | gzip ; fi ;;
    import-db)
      local file ; file="$(rt_file_arg "$@")" ;
      [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
      case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | rt_lando_x "${root}" database bash -c "${dbcmd}" ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) ( cd "${root}" && rt_lando_cli logs -s appserver ) | tail -n "${LOG_LINES:-200}" ;;
    version|--version|-v) echo "the Webship Workspace's lando runtime (no DDEV), lando $(rt_lando_cli version 2>/dev/null)" ;;
    *) echo "The lando runtime cannot run 'ddev ${verb}' (webship/workspace#729)." >&2 ; return 1 ;;
  esac
}
