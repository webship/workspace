#!/usr/bin/env bash
# The container runtimes of the Webship Workspace (webship/workspace#694): DDEV by default, and Docker Compose and
# Podman for a project built with --runtime docker|podman (Kubernetes, Lando and Docksal follow on this layer).
#
# Every builder, tool and menu speaks DDEV's verbs (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`,
# `ddev exec`, `ddev export-db` ...). On a DDEV project those are DDEV itself, exactly as before. On another runtime
# the `ddev` function below gives each verb its meaning there, so the same builders and plugins work unchanged.
#
# A project's runtime is what it carries: .ddev/config.yaml (DDEV), or a compose.yaml with an `x-webship:` block
# (Docker, Podman, or Kubernetes, whose manifests are written from it into k8s/). A new build takes WORKSPACE_RUNTIME (a builder's --runtime), else settings.yml's
# container.runtime, else DDEV.

RT_STACKS="${WORKSPACE_ROOT:-}/core/config/runtimes"

# The project's root and runtime, looking up from a folder: "<runtime> <root>", or nothing.
function rt_find_project() {
  local d="${1:-$PWD}" ;
  d="$(cd "${d}" 2>/dev/null && pwd)" || return 1 ;
  while [ -n "${d}" ] && [ "${d}" != "/" ] ; do
    if [ -f "${d}/.ddev/config.yaml" ] ; then echo "ddev ${d}" ; return 0 ; fi
    if [ -f "${d}/compose.yaml" ] && grep -q '^x-webship:' "${d}/compose.yaml" ; then
      echo "$(sed -n '/^x-webship:/,/^[^ ]/s/^  runtime: *//p' "${d}/compose.yaml" | head -1 | tr -d '"') ${d}" ; return 0 ;
    fi
    d="$(dirname "${d}")" ;
  done
  return 1 ;
}

# The runtime of a folder's project, or of a new build: ddev, docker or podman.
function runtime_of() {
  local found ;
  found="$(rt_find_project "${1:-$PWD}")" && { echo "${found%% *}" ; return 0 ; } ;
  # A builder's --runtime (RUNTIME), else WORKSPACE_RUNTIME, else settings.yml's container.runtime, else DDEV.
  local asked="${RUNTIME:-_none_}" ; [ "${asked}" = '_none_' ] && asked="" ;
  echo "${asked:-${WORKSPACE_RUNTIME:-${container_runtime:-ddev}}}" ;
}

# A value of the project's x-webship block.
function rt_meta() { sed -n '/^x-webship:/,/^[^ x]/s/^  '"$1"': *//p' "$2/compose.yaml" | head -1 | tr -d '"' ; }

# The address of the project's site.
function rt_url() {
  local found rt root ;
  found="$(rt_find_project "${1:-$PWD}")" || { echo "https://${PROJECT_NAME}.ddev.site" ; return 0 ; } ;
  rt="${found%% *}" ; root="${found#* }" ;
  case "${rt}" in
    ddev) echo "https://$(sed -n 's/^name: *//p' "${root}/.ddev/config.yaml" | head -1).ddev.site" ;;
    kubernetes) echo "http://$(rt_k8s_node_ip):$(rt_meta port "${root}")" ;;
    *) echo "http://127.0.0.1:$(rt_meta port "${root}")" ;;
  esac
}

function ddev() {
  local rt ; rt="$(runtime_of)" ;
  case "${rt}" in
    ''|ddev) command ddev "$@" ;;
    docker|podman) rt_compose "${rt}" "$@" ;;
    kubernetes) rt_k8s "$@" ;;
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
  local rt="$1" root="$2" name="$3" type="$4" docroot="$5" php="$6" db="$7" port="$8" ;
  mkdir -p "${root}/.webship/runtime" ;
  cp "${RT_STACKS}/php/Dockerfile" "${root}/.webship/runtime/Dockerfile" ;
  cat > "${root}/compose.yaml" <<YAML
# Written by the Webship Workspace (its ${rt} runtime, webship/workspace#694). Run it with: ${rt} compose up -d
name: ${name}
x-webship:
  runtime: ${rt}
  stack: php
  type: ${type}
  docroot: "${docroot}"
  php: "${php}"
  database: "${db}"
  port: ${port}
services:
  web:
    build:
      context: .webship/runtime
      args:
        PHP_VERSION: "${php}"
        UID: "$(id -u)"
        GID: "$(id -g)"
    image: webship-${name}-web
    environment:
      APACHE_DOCUMENT_ROOT: /var/www/html${docroot:+/${docroot}}
      WEBSHIP_RUNTIME: ${rt}
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
    image: axllent/mailpit
volumes:
  db:
YAML
}

# What DDEV does on start for a Drupal project: settings.php from default.settings.php, and the database settings in
# a file of the runtime's own, included from settings.php (never a $databases block in settings.php itself).
function rt_drupal_settings() {
  local root="$1" docroot ; docroot="$(rt_meta docroot "${root}")" ;
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
if (empty($settings['hash_salt'])) {
  $settings['hash_salt'] = hash('sha256', __DIR__);
}
PHP
  grep -q 'settings.webship-runtime.php' "${dir}/settings.php" || cat >> "${dir}/settings.php" <<'PHP'

// The Webship Workspace's container runtime (Docker, Podman, Kubernetes): its database settings.
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
      local name type docroot php db port a ;
      name="$( [ -f "${root}/compose.yaml" ] && sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1 )" ;
      type="$( [ -f "${root}/compose.yaml" ] && rt_meta type "${root}" )" ; docroot="$( [ -f "${root}/compose.yaml" ] && rt_meta docroot "${root}" )" ;
      php="$( [ -f "${root}/compose.yaml" ] && rt_meta php "${root}" )" ; db="$( [ -f "${root}/compose.yaml" ] && rt_meta database "${root}" )" ;
      port="$( [ -f "${root}/compose.yaml" ] && rt_meta port "${root}" )" ;
      for a in "$@" ; do
        case "${a}" in
          --project-name=*) name="${a#*=}" ;; --project-type=*) type="${a#*=}" ;; --docroot=*) docroot="${a#*=}" ;;
          --php-version=*) php="${a#*=}" ;; --database=*) db="${a#*=}" ; db="${db#*:}" ;;
        esac
      done
      rt_compose_write "${rt}" "${root}" "${name:-$(basename "${root}")}" "${type:-php}" "${docroot}" "${php:-8.3}" "${db:-10.11}" "${port:-$(rt_free_port)}" ;
      echo "Wrote compose.yaml for ${rt} (${type:-php}, PHP ${php:-8.3}, MariaDB ${db:-10.11}): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No ${rt} project here." >&2 ; return 1 ; } ;
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
      echo "$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1) on ${rt}: $(rt_url "${root}")" ; rt_dc "${rt}" "${root}" ps ;;
    delete)
      if [ -n "${root}" ] ; then rt_dc "${rt}" "${root}" down -v --remove-orphans ;
      else local n ; for n in "$@" ; do case "${n}" in -*) ;; *) docker compose -p "${n}" down -v --remove-orphans 2>/dev/null ;; esac ; done ; fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web bash -c "$(rt_create_project_cmd "$@")" ;
      else rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web composer "$@" ; fi ;;
    drush) rt_dc "${rt}" "${root}" exec -T -u www-data -w "/var/www/html" web /var/www/html/vendor/bin/drush "$@" ;;
    php|npm|npx|node|yarn|wp) rt_dc "${rt}" "${root}" exec -T -u www-data -w "${workdir}" web "${verb}" "$@" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; *) break ;; esac ; done
      rt_dc "${rt}" "${root}" exec -T -u "$( [ "${svc}" = web ] && echo www-data || echo root )" -w "${workdir}" "${svc}" bash -c "$*" ;;
    ssh) rt_dc "${rt}" "${root}" exec -u www-data web bash ;;
    mysql) rt_dc "${rt}" "${root}" exec -T db mariadb -udb -pdb db "$@" ;;
    export-db)
      local file="" a ; for a in "$@" ; do case "${a}" in --file=*) file="${a#*=}" ;; esac ; done
      if [ -n "${file}" ] ; then rt_dc "${rt}" "${root}" exec -T db mariadb-dump -udb -pdb db | gzip > "${file}" ;
      else rt_dc "${rt}" "${root}" exec -T db mariadb-dump -udb -pdb db | gzip ; fi ;;
    import-db)
      local file="" a ; for a in "$@" ; do case "${a}" in --file=*|--src=*) file="${a#*=}" ;; esac ; done
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
  local used p ; used="$(rt_kubectl get svc -A -o jsonpath='{range .items[*]}{range .spec.ports[*]}{.nodePort} {end}{end}' 2>/dev/null)" ;
  for p in $(seq 30080 32767) ; do case " ${used} " in *" ${p} "*) ;; *) echo "${p}" ; return 0 ;; esac ; done ;
}

function rt_k8s_write() {
  local root="$1" name type docroot php db port ns ;
  name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ; docroot="$(rt_meta docroot "${root}")" ;
  db="$(rt_meta database "${root}")" ; port="$(rt_meta port "${root}")" ; ns="ws-${name}" ;
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
          image: webship-${name}-web
          imagePullPolicy: Never
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
      local port="" ; [ -n "${root}" ] && port="$(rt_meta port "${root}")" ;
      root="${root:-$PWD}" ;
      rt_compose kubernetes config "$@" > /dev/null || return 1 ;
      [ -n "${port}" ] || sed -i "s/^  port: .*/  port: $(rt_k8s_free_nodeport)/" "${root}/compose.yaml" ;
      sed -i '/^    ports:$/,/^      - "127.0.0.1:/d' "${root}/compose.yaml" ;
      rt_k8s_write "${root}" ;
      echo "Wrote compose.yaml and k8s/ for kubernetes ($(rt_kctx)): $(rt_url "${root}")" ;;
    start|restart)
      [ -n "${root}" ] || { echo "No kubernetes project here." >&2 ; return 1 ; } ;
      rt_k8s_cluster || return 1 ;
      local name ; name="$(sed -n 's/^name: *//p' "${root}/compose.yaml" | head -1)" ;
      docker build -q -t "webship-${name}-web" --build-arg PHP_VERSION="$(rt_meta php "${root}")" --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" "${root}/.webship/runtime" > /dev/null || return 1 ;
      case "$(rt_kctx)" in kind-*) kind load docker-image "webship-${name}-web" --name "${RT_KIND_CLUSTER}" > /dev/null || return 1 ;; esac ;
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
      echo "${ns#ws-} on kubernetes ($(rt_kctx)): $(rt_url "${root}")" ; rt_kubectl -n "${ns}" get pods ;;
    delete)
      if [ -n "${root}" ] ; then rt_kubectl delete ns "${ns}" --wait=true ;
      else local n ; for n in "$@" ; do case "${n}" in -*) ;; *) rt_kubectl delete ns "ws-${n}" --ignore-not-found --wait=true 2>/dev/null ;; esac ; done ; fi ;;
    composer)
      if [ "${1:-}" = create-project ] ; then kx web runuser -u www-data -- env COMPOSER_HOME=/tmp/composer bash -c "cd '${workdir}' && $(rt_create_project_cmd "$@")" ;
      else kx web runuser -u www-data -- env COMPOSER_HOME=/tmp/composer bash -c "cd '${workdir}' && composer $(printf '%q ' "$@")" ; fi ;;
    drush) kx web runuser -u www-data -- bash -c "cd /var/www/html && vendor/bin/drush $(printf '%q ' "$@")" ;;
    php|npm|npx|node|yarn|wp) kx web runuser -u www-data -- bash -c "cd '${workdir}' && ${verb} $(printf '%q ' "$@")" ;;
    exec)
      local svc=web ; while [ $# -gt 0 ] ; do case "$1" in -s|--service) svc="$2" ; shift 2 ;; -d|--dir) workdir="$2" ; shift 2 ;; --raw) shift ;; *) break ;; esac ; done
      if [ "${svc}" = web ] ; then kx web runuser -u www-data -- bash -c "cd '${workdir}' && $*" ; else kx "${svc}" bash -c "$*" ; fi ;;
    ssh) rt_kubectl -n "${ns}" exec -it deploy/web -c web -- runuser -u www-data -- bash ;;
    mysql) kx db mariadb -udb -pdb db "$@" ;;
    export-db)
      local file="" a ; for a in "$@" ; do case "${a}" in --file=*) file="${a#*=}" ;; esac ; done
      if [ -n "${file}" ] ; then kx db mariadb-dump -udb -pdb db | gzip > "${file}" ; else kx db mariadb-dump -udb -pdb db | gzip ; fi ;;
    import-db)
      local file="" a ; for a in "$@" ; do case "${a}" in --file=*|--src=*) file="${a#*=}" ;; esac ; done
      [ -f "${file}" ] || { echo "No such file: ${file}" >&2 ; return 1 ; } ;
      case "${file}" in *.gz) gunzip -c "${file}" ;; *) cat "${file}" ;; esac | kx db mariadb -udb -pdb db ;;
    launch) echo "$(rt_url "${root}")${1:-}" ;;
    logs) rt_kubectl -n "${ns}" logs deploy/web --tail "${LOG_LINES:-200}" ;;
    version|--version|-v) echo "the Webship Workspace's kubernetes runtime (no DDEV), context $(rt_kctx)" ;;
    *) echo "The kubernetes runtime cannot run 'ddev ${verb}' (webship/workspace#694)." >&2 ; return 1 ;;
  esac
}
