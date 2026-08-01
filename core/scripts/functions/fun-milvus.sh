#!/usr/bin/env bash

# Milvus (https://github.com/milvus-io/milvus), self-hosted inside DDEV.
#
# Milvus standalone is three containers, not one: the database itself, etcd for its metadata, and
# MinIO for the segment/object store. Since 2.6 the write-ahead log is the built-in Woodpecker
# (MQ_TYPE=woodpecker), so there is no Pulsar or Kafka to run — that is the whole reason
# standalone is viable on a laptop. Attu is the web UI on top.
#
#   Browser ──https──▶ ddev-router ──▶ ddev-<project>-web (nginx reverse proxy)
#                                          ├─▶ milvus-attu:3000          the UI
#                                          ├─▶ milvus-standalone:19530   /v2/… REST
#                                          └─▶ milvus-standalone:9091    /webui/, /healthz
#
#   pymilvus / MCP / notebook ──▶ 127.0.0.1:<grpc_port> ──▶ milvus-standalone:19530
#
# The gRPC port is PUBLISHED on the host, which the rest of this workspace's DDEV projects never
# need to do. It has to be: the DDEV router terminates HTTP(S) only, and every real Milvus client
# — pymilvus, the MCP server, LangChain — speaks gRPC. The HTTPS origin still gets the UI and the
# REST API, so nothing that can go through the router does anything else.
#
# The project is NOT a Drupal site: `--project-type=php` with settings management disabled and no
# docroot, because nothing in it is served from disk.

# parse_yaml keeps a value's own quotes, so `version: "v2.6.21"` reaches the shell as the
# nine-character string `"v2.6.21"` — which lands in an image tag as milvusdb/milvus:"v2.6.21"
# and makes every `${x:-fallback}` default silently stop working on an empty quoted string.
# Strip one layer of matching quotes from anything read from settings.
function milvus_setting() {
  local value="$1";
  case "${value}" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value}";
}

# The project a command acts on: the argument, else milvus.project from the settings.
function milvus_resolve_project() {
  local given="$1" name;
  if [ -n "${given}" ] && [ "${given}" != '_settings_' ] ; then
    printf '%s' "${given}" ; return 0 ;
  fi
  name="$(milvus_setting "${milvus_project}")";
  printf '%s' "${name:-milvus}";
}

# The one origin Attu is served on, resolved the same way build_milvus resolves it.
function milvus_resolve_url() {
  local project="$1" setting;
  setting="$(milvus_setting "${milvus_public_uri}")";
  case "${setting:-hub}" in
    hub)       printf 'https://%s.%s.workspace.ddev.site' "${project}" "${doc_name}" ;;
    canonical) printf 'https://%s.ddev.site' "${project}" ;;
    *)         printf '%s' "${setting}" ;;
  esac
}

# The host port an existing instance publishes Milvus on.
#
# Read from the compose file the build wrote, not from the settings: the settings hold the port to
# START scanning from, and an instance built while 19530 was busy is on 19531. Falls back to
# asking docker, then to the setting, so this answers for an instance built by an older version of
# this command too.
function milvus_host_port() {
  local project="$1" compose port;
  compose="${WORKSPACE_ROOT}/${doc_name}/${project}/.ddev/docker-compose.milvus.yaml";

  if [ -f "${compose}" ] ; then
    port="$(sed -n 's/^ *- "\([0-9]\+\):19530"$/\1/p' "${compose}" | head -1)";
    [ -n "${port}" ] && { printf '%s' "${port}" ; return 0 ; }
  fi

  port="$(docker port "ddev-${project}-milvus-standalone" 19530/tcp 2>/dev/null | head -1 | sed 's/.*://')";
  [ -n "${port}" ] && { printf '%s' "${port}" ; return 0 ; }

  port="$(milvus_setting "${milvus_grpc_port}")";
  printf '%s' "${port:-19530}";
}

# What a client connects to. Everything in this workspace that is not a browser uses this:
# cmd-tools-ragify.sh, cmd-tools-rag.sh and the MCP server.
#
# Two answers, because these commands run in two places. On the HOST it is the published port. In a
# CONTAINER — the dashboard runs its jobs inside ddev-workspace-web — 127.0.0.1 is that container,
# and this machine's firewall drops container-to-host traffic anyway, so the published port is
# unreachable there. DDEV puts every project's containers on the shared `ddev_default` network, so
# the answer inside one is the Milvus container's own name: same port, same protocol, no proxy
# involved (Milvus multiplexes gRPC and REST on 19530).
function milvus_uri() {
  local project="$1" port;
  port="$(milvus_host_port "${project}")";

  if [ -f /.dockerenv ] || [ -n "${DDEV_SITENAME}" ] ; then
    printf 'http://ddev-%s-milvus-standalone:19530' "${project}";
    return 0 ;
  fi
  printf 'http://127.0.0.1:%s' "${port}";
}

# The token clients authenticate with, empty when authorization is off (the default).
function milvus_token() {
  local auth;
  auth="$(milvus_setting "${milvus_authorization}")";
  [ "${auth}" == 'true' ] || return 0 ;
  printf '%s' "$(milvus_setting "${milvus_token}")";
}

# Refuse politely rather than erroring deep inside pymilvus.
function milvus_require_running() {
  local project="$1";
  if ! docker ps --format '{{.Names}}' | grep -qx "ddev-${project}-milvus-standalone" ; then
    echo "Milvus ${project} is not running.";
    echo "  Start it:  cd ${WORKSPACE_ROOT}/${doc_name}/${project} && ddev start";
    echo "  Build it:  cd ${WORKSPACE_ROOT}/${doc_name} && bash cmd-milvus-project.sh ${project}";
    return 1 ;
  fi
  return 0 ;
}

# The next free host port from $1 upwards, as seen by docker — one instance per index set is a
# normal thing to want, and each publishes its own gRPC port.
function milvus_free_port() {
  local port="$1" taken;
  taken="$(docker ps --format '{{.Ports}}' 2>/dev/null)";
  while printf '%s' "${taken}" | grep -q ":${port}->" ; do
    port=$((port + 1));
    if [ "${port}" -gt "$(( $1 + 40 ))" ] ; then
      printf '%s' "$1" ; return 0 ;      # give up scanning and let ddev report the conflict
    fi
  done
  printf '%s' "${port}";
}

# Wait for Milvus to answer its own health endpoint. The container is "running" long before the
# database will accept a connection — a first start loads the WAL and creates the MinIO bucket —
# so anything that connects immediately after `ddev start` fails with a confusing gRPC error.
function milvus_wait_healthy() {
  local project="$1" waited=0 limit="${2:-180}";
  printf 'Waiting for Milvus to become healthy';
  until docker exec "ddev-${project}-milvus-standalone" curl -sf http://localhost:9091/healthz > /dev/null 2>&1 ; do
    printf '.';
    sleep 3 ; waited=$((waited + 3));
    if [ "${waited}" -ge "${limit}" ] ; then
      printf '\n';
      echo "Milvus did not report healthy within ${limit}s. Look at:";
      echo "  docker logs ddev-${project}-milvus-standalone";
      return 1 ;
    fi
  done
  printf ' healthy after %ss.\n' "${waited}";
  return 0 ;
}

# Write .ddev/docker-compose.milvus.yaml for one instance.
#
# $1 the project directory, $2 the Milvus image tag, $3 the Attu tag, $4 the published gRPC port,
# $5 "true" to turn Milvus authentication on
function milvus_write_compose() {
  local project_dir="$1" version="$2" attu_version="$3" grpc_port="$4" authorization="$5";

  mkdir -p "${project_dir}/.ddev" ;

  cat > "${project_dir}/.ddev/docker-compose.milvus.yaml" <<COMPOSEEOF
## Milvus standalone, orchestrated by DDEV.
## Written by cmd-milvus-project.sh — re-run that command rather than editing by hand.
## The DDEV web container (nginx) reverse-proxies the Attu UI, the REST API and the Milvus WebUI;
## the gRPC port is published on the host because the router speaks HTTP(S) only.
## Every service is on the DDEV project's 'default' network, so they resolve each other by name.

volumes:
  milvus_etcd:
  milvus_minio:
  milvus_data:

services:
  milvus-etcd:
    container_name: ddev-\${DDEV_SITENAME}-milvus-etcd
    image: "quay.io/coreos/etcd:v3.5.25"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    environment:
      ETCD_AUTO_COMPACTION_MODE: revision
      ETCD_AUTO_COMPACTION_RETENTION: "1000"
      ETCD_QUOTA_BACKEND_BYTES: "4294967296"
      ETCD_SNAPSHOT_COUNT: "50000"
    volumes:
      - milvus_etcd:/etcd
    command: etcd -advertise-client-urls=http://milvus-etcd:2379 -listen-client-urls http://0.0.0.0:2379 --data-dir /etcd
    healthcheck:
      test: ["CMD", "etcdctl", "endpoint", "health"]
      interval: 30s
      timeout: 20s
      retries: 3

  milvus-minio:
    container_name: ddev-\${DDEV_SITENAME}-milvus-minio
    image: "minio/minio:RELEASE.2024-12-18T13-15-44Z"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    environment:
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
    volumes:
      - milvus_minio:/minio_data
    ## No host ports: the console is reached through the project's own https origin at /minio/,
    ## which is what keeps a second instance from colliding on 9000/9001.
    command: minio server /minio_data --console-address ":9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      timeout: 20s
      retries: 3

  milvus-standalone:
    container_name: ddev-\${DDEV_SITENAME}-milvus-standalone
    image: "milvusdb/milvus:${version}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    command: ["milvus", "run", "standalone"]
    security_opt:
      - seccomp:unconfined
    environment:
      ETCD_ENDPOINTS: milvus-etcd:2379
      MINIO_ADDRESS: milvus-minio:9000
      ## Woodpecker is the built-in WAL introduced in 2.6 — it is what removes the Pulsar
      ## dependency that used to make standalone Milvus a five-container stack.
      MQ_TYPE: woodpecker
      COMMON_SECURITY_AUTHORIZATIONENABLED: "${authorization}"
    volumes:
      - milvus_data:/var/lib/milvus
    ## Published on the host: pymilvus, the MCP server and every other real client speak gRPC,
    ## and the DDEV router cannot carry that. The HTTPS origin still serves the UI and REST.
    ports:
      - "${grpc_port}:19530"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9091/healthz"]
      interval: 30s
      start_period: 90s
      timeout: 20s
      retries: 3
    depends_on:
      milvus-etcd:
        condition: service_healthy
      milvus-minio:
        condition: service_healthy

  milvus-attu:
    container_name: ddev-\${DDEV_SITENAME}-milvus-attu
    image: "zilliz/attu:${attu_version}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    depends_on:
      - milvus-standalone
    environment:
      ## Attu's server-side half talks to Milvus inside the network, so the browser never needs
      ## the gRPC port and the UI works over plain https.
      MILVUS_URL: milvus-standalone:19530
COMPOSEEOF
}

# Write the nginx site config that turns the DDEV web container into the reverse proxy.
# A full replacement (nginx_full), because none of the default PHP site config applies to a
# project that serves no files of its own.
function milvus_write_nginx() {
  local project_dir="$1";

  mkdir -p "${project_dir}/.ddev/nginx_full" ;

  cat > "${project_dir}/.ddev/nginx_full/nginx-site.conf" <<'NGINXEOF'
# DDEV web container nginx: reverse-proxy the Milvus stack.
# Full replacement of the default site config (nginx_full).
# Written by cmd-milvus-project.sh — re-run that command rather than editing by hand.

server {
    listen 80 default_server;
    listen 443 ssl default_server;

    root /var/www/html;

    ssl_certificate /etc/ssl/certs/master.crt;
    ssl_certificate_key /etc/ssl/certs/master.key;

    include /etc/nginx/monitoring.conf;

    # Bulk inserts and collection imports go through the REST API.
    client_max_body_size 512M;

    include /etc/nginx/common.d/*.conf;

    # Milvus's own REST API, on the same port as gRPC — Milvus multiplexes both on 19530, so
    # this is the plain-HTTP half of the same listener. Anything that can speak HTTP (curl, a
    # Drupal module, the dashboard) can use the database over the project's https origin with no
    # published port and no gRPC client.
    location /v2/ {
        proxy_pass http://milvus-standalone:19530;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }

    # Milvus's built-in web console and health endpoint (port 9091), which is a different server
    # from the API above.
    location /webui/ {
        proxy_pass http://milvus-standalone:9091/webui/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /healthz {
        proxy_pass http://milvus-standalone:9091/healthz;
        proxy_set_header Host $host;
    }

    # The MinIO console, so the segment store is inspectable without publishing 9001 on the host.
    location /minio/ {
        proxy_pass http://milvus-minio:9001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Attu, the Milvus UI, on the root.
    location / {
        proxy_pass http://milvus-attu:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # Attu streams collection loads over a websocket.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 75s;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    include /etc/nginx/server.d/*.conf;
}
NGINXEOF
}

# Build (or rebuild) a Milvus instance in the calling workspace folder.
#
# The calling cmd-*.sh sets nothing but the workspace: everything else comes from the arguments
# in args/arg-milvus.sh, defaulting to the `milvus:` block of the workspace settings.
function build_milvus() {

  # The workspace settings hold the defaults; an argument that was actually given wins. The
  # sentinel is what tells the two apart — argparse cannot report "not given" on its own.
  if [ "${PROJECT_NAME}" == '_settings_' ] ; then PROJECT_NAME="$(milvus_setting "${milvus_project}")"; PROJECT_NAME="${PROJECT_NAME:-milvus}"; fi
  if [ "${MILVUS_VERSION}" == '_settings_' ] ; then MILVUS_VERSION="$(milvus_setting "${milvus_version}")"; MILVUS_VERSION="${MILVUS_VERSION:-v2.6.21}"; fi
  if [ "${ATTU_VERSION}" == '_settings_' ] ; then ATTU_VERSION="$(milvus_setting "${milvus_attu_version}")"; ATTU_VERSION="${ATTU_VERSION:-v2.6.5}"; fi

  local project_dir="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  local base_url="https://${PROJECT_NAME}.ddev.site";
  local hub_url="https://${PROJECT_NAME}.${doc_name}.workspace.ddev.site";
  local public_uri other_url grpc_port authorization;

  public_uri="${PUBLIC_URI}";
  if [ "${public_uri}" == '_settings_' ] ; then
    public_uri="$(milvus_setting "${milvus_public_uri}")";
    public_uri="${public_uri:-hub}";
  fi
  case "${public_uri}" in
    hub)       public_uri="${hub_url}";  other_url="${base_url}" ;;
    canonical) public_uri="${base_url}"; other_url="${hub_url}" ;;
    *)         other_url="" ;;
  esac

  grpc_port="${GRPC_PORT}";
  if [ "${grpc_port}" == '_settings_' ] ; then
    grpc_port="$(milvus_setting "${milvus_grpc_port}")";
    grpc_port="${grpc_port:-19530}";
  fi
  grpc_port="$(milvus_free_port "${grpc_port}")";

  authorization="$(milvus_setting "${milvus_authorization}")";
  [ "${AUTHORIZATION}" == 'yes' ] && authorization="true";
  authorization="${authorization:-false}";

  cd "${WORKSPACE_ROOT}/${doc_name}" || exit 1 ;

  if [ -d "${PROJECT_NAME}" ] ; then
    if [ "${FORCE}" != 'yes' ] ; then
      echo "";
      echo "${PROJECT_NAME} already exists in ${WORKSPACE_ROOT}/${doc_name}.";
      echo "  Start it with:   cd ${project_dir} && ddev start";
      echo "  Rebuild it with: bash cmd-milvus-project.sh ${PROJECT_NAME} --force";
      echo "  (--force deletes the Milvus volumes too, so every collection in it goes with them.)";
      exit 1 ;
    fi
    echo "Removing the existing ${PROJECT_NAME} instance, its metadata and every collection in it.";
    # -O removes the project's volumes: for this project that is etcd's metadata, MinIO's
    # segments and the Milvus data directory — i.e. all of the indexed data.
    (cd "${project_dir}" && ddev delete -y -O) ;
    rm -rf "${project_dir}" ;
  fi

  mkdir -p "${project_dir}" ;
  cd "${project_dir}" || exit 1 ;

  # No docroot and no settings management: this project serves no files of its own, it proxies.
  ddev config --project-name=${PROJECT_NAME} --project-type=php --docroot="" --disable-settings-management ;

  milvus_write_compose "${project_dir}" "${MILVUS_VERSION}" "${ATTU_VERSION}" "${grpc_port}" "${authorization}" ;
  milvus_write_nginx "${project_dir}" ;

  echo "";
  echo "Starting Milvus ${MILVUS_VERSION} — the first run pulls ~2 GB of images, which takes a few minutes.";
  ddev start -y ;

  milvus_wait_healthy "${PROJECT_NAME}" || true ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Milvus ${MILVUS_VERSION} is ready.";
  echo "";
  echo "  Attu (the UI)      ${public_uri}";
  echo "  Milvus WebUI       ${public_uri}/webui/";
  echo "  REST API           ${public_uri}/v2/vectordb/collections/list";
  echo "  MinIO console      ${public_uri}/minio/   (minioadmin / minioadmin)";
  echo "";
  echo "  Clients on this machine — pymilvus, the MCP server, LangChain — connect on gRPC:";
  echo "    http://127.0.0.1:${grpc_port}";
  if [ "${authorization}" == 'true' ] ; then
    echo "    token: $(milvus_setting "${milvus_token}")  (authentication is ON for this instance)";
  else
    echo "    No authentication: a local development database on a DDEV network.";
  fi
  if [ -n "${other_url}" ] ; then
    echo "";
    echo "  ${other_url} reaches the same instance.";
  fi
  echo "";
  echo "  Index a project into it:";
  echo "    cd ${WORKSPACE_ROOT}/<workspace> && bash cmd-tools-ragify.sh <project>";
  echo "  Give it to the Claude Code CLI:";
  echo "    cd ${WORKSPACE_ROOT}/${doc_name} && bash cmd-milvus-mcp.sh ${PROJECT_NAME} -a register";
  echo "*---------------------------------------------------------------------*";

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi
}

# Back up one instance. Milvus keeps its metadata in etcd and its segments in MinIO, and a dump of
# either alone restores nothing — so both volumes are archived together, plus a JSON manifest of
# the collections so a restore can be checked against what went in.
function milvus_backup() {
  local project stamp out archive manifest;
  project="$(milvus_resolve_project "${PROJECT_NAME}")";
  milvus_require_running "${project}" || return 1 ;

  stamp="$(date +%Y-%m-%d-%H%M%S)";
  out="${backups}/${doc_name}/${project}";
  mkdir -p "${out}" ;
  archive="${out}/${project}-milvus-${stamp}.tar.gz";
  manifest="${out}/${project}-milvus-${stamp}.collections.json";

  echo "Writing the collection manifest.";
  rag_python collections --uri "$(milvus_uri "${project}")" --token "$(milvus_token)" --json > "${manifest}" 2>/dev/null \
    || echo "  (could not reach Milvus for the manifest — archiving the volumes anyway)";

  echo "Archiving the etcd metadata, the MinIO segments and the Milvus data directory.";
  # The data lives in named volumes, not in the project directory, so it is read through a
  # throwaway container. --user, or the archive lands owned by root: a backup the user cannot
  # delete is a bad backup.
  if ! docker run --rm --user "$(id -u):$(id -g)" \
       -v "ddev-${project}_milvus_etcd:/v/etcd:ro" \
       -v "ddev-${project}_milvus_minio:/v/minio:ro" \
       -v "ddev-${project}_milvus_data:/v/milvus:ro" \
       -v "${out}:/out" \
       busybox tar czf "/out/$(basename "${archive}")" -C /v . ; then
    echo "The archive failed — removing the partial file.";
    rm -f "${archive}" ;
    return 1 ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Backed up ${project}:";
  echo "    ${archive}";
  echo "    ${manifest}";
  echo "";
  echo "  Restore into a STOPPED instance of the same Milvus version:";
  echo "    docker run --rm -v ddev-${project}_milvus_etcd:/v/etcd \\";
  echo "      -v ddev-${project}_milvus_minio:/v/minio -v ddev-${project}_milvus_data:/v/milvus \\";
  echo "      -v ${out}:/in busybox tar xzf /in/$(basename "${archive}") -C /v";
  echo "  Re-indexing with cmd-tools-ragify.sh is usually simpler — an index is derived data.";
  echo "*---------------------------------------------------------------------*";
}

# The Milvus MCP server, and its one-line Claude Code registration.
#
# zilliztech/mcp-server-milvus is a Python FastMCP server with 14 milvus_* tools (list/create/load
# collections, text, vector and hybrid search, query, insert, delete). Registered on **stdio**, so
# there is no port to keep open and no daemon to remember: the CLI starts it when a session needs
# it and stops it after. It connects to the database over the published gRPC port, which is why
# the instance has to be running for the tools to answer.
function milvus_mcp() {
  local project uri package name token;
  project="$(milvus_resolve_project "${PROJECT_NAME}")";
  uri="$(milvus_uri "${project}")";
  package="$(milvus_setting "${milvus_mcp_package}")"; package="${package:-mcp-server-milvus==0.1.1.dev9}";
  name="rag-${project}";
  token="$(milvus_token)";

  # The published wheel declares `fastmcp` but imports `mcp.server.fastmcp`, so on its own
  # dependency set it dies at import with ModuleNotFoundError — which the Claude Code CLI reports
  # only as "Connection closed". The missing package is injected here rather than left to be
  # discovered. Pinned below 2 for the same reason graphify pins it: mcp 2.x moved that module.
  local with_mcp='--with mcp<2';

  case "${MCP_ACTION}" in
    status)
      milvus_require_running "${project}" && echo "Milvus ${project} is running on ${uri}." ;
      curl -s -o /dev/null -w "  REST /v2/vectordb/collections/list → HTTP %{http_code}\n" \
        -X POST "${uri}/v2/vectordb/collections/list" -H 'Content-Type: application/json' -d '{}' ;
      claude mcp list 2>/dev/null | grep -i "${name}" || echo "  Not registered in Claude Code yet — run with -a register.";
      ;;
    register)
      milvus_require_running "${project}" || return 1 ;
      # Prove the server can actually start before registering it: an import error here is a
      # sentence, and the same error after registration is only "Connection closed" in a session
      # three days later. It exits on EOF, so an empty stdin is the whole test.
      if ! uvx --from "${package}" ${with_mcp} mcp-server-milvus --milvus-uri "${uri}" < /dev/null > /dev/null 2>&1 ; then
        echo "The Milvus MCP server (${package}) will not start. Run it by hand to see why:";
        echo "  uvx --from ${package} ${with_mcp} mcp-server-milvus --milvus-uri ${uri}";
        return 1 ;
      fi
      # uvx resolves and caches the package on first use; no install step of our own to keep in
      # sync. The pin carries a .devN suffix because that is all PyPI has published — without it
      # uvx refuses the package as pre-release only.
      if [ -n "${token}" ] ; then
        claude mcp add --scope user --env "MILVUS_TOKEN=${token}" "${name}" \
          -- uvx --from "${package}" ${with_mcp} mcp-server-milvus --milvus-uri "${uri}" || return 1 ;
      else
        claude mcp add --scope user "${name}" \
          -- uvx --from "${package}" ${with_mcp} mcp-server-milvus --milvus-uri "${uri}" || return 1 ;
      fi
      echo "";
      echo "Registered ${name} with the Claude Code CLI (stdio, no port).";
      echo "  Open a NEW session to see its 13 tools: milvus_list_collections, milvus_text_search,";
      echo "  milvus_vector_search, milvus_hybrid_search, milvus_query, milvus_get_collection_info,";
      echo "  milvus_create_collection, milvus_insert_data, milvus_delete_entities,";
      echo "  milvus_load_collection, milvus_release_collection, milvus_list_databases,";
      echo "  milvus_use_database.";
      echo "  Re-indexing needs no re-registration — the URI does not change.";
      ;;
    unregister)
      claude mcp remove --scope user "${name}" && echo "Removed ${name} from the Claude Code CLI." ;
      ;;
    serve)
      milvus_require_running "${project}" || return 1 ;
      echo "Serving Milvus ${project} over MCP on stdio — Ctrl+C to stop.";
      [ -n "${token}" ] && export MILVUS_TOKEN="${token}" ;
      exec uvx --from "${package}" ${with_mcp} mcp-server-milvus --milvus-uri "${uri}" ;
      ;;
    *)
      echo "Pick one of -a status, -a register, -a unregister or -a serve.";
      return 1 ;
      ;;
  esac
}
