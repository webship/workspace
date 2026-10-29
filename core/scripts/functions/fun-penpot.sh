#!/usr/bin/env bash

# Penpot, self-hosted inside DDEV.
#
# The whole Penpot stack runs as DDEV custom compose services on the project's
# `default` network, so they resolve each other by service name, and DDEV's own
# web container (nginx) reverse-proxies the site to `penpot-frontend:8080`. DDEV
# owns the router and the TLS certificate, which is what makes
# https://<project>.ddev.site work with no host ports and no standalone
# docker-compose stack to keep in sync.
#
#   Browser ──https──▶ ddev-router ──▶ ddev-<project>-web (nginx reverse proxy)
#                                          └─▶ penpot-frontend:8080
#      penpot-frontend ─▶ penpot-backend ─▶ penpot-postgres (15)
#           │                  └──────────▶ penpot-valkey   (redis)
#           └─▶ penpot-exporter        penpot-mailcatch (SMTP catcher)
#
# Reference: products/ai_penpot/docs/penpot-on-ddev.md, which this command
# automates end to end — it used to be a page of copy-paste.
#
# The project is NOT a Drupal site: it is `--project-type=php` with settings
# management disabled and no docroot, because nothing in it is served from disk.

# The last-resort flag set, used only when the workspace settings carry none.
# `enable-plugins` is what the Penpot MCP needs, and
# `enable-access-tokens` is what the AI Penpot Drupal module needs — without the
# latter a token is silently ignored (requests resolve to Anonymous, not a 401),
# which is a bad afternoon. Registration is open and email verification off, so
# registering logs you straight in on a local instance.
PENPOT_DEFAULT_FLAGS="disable-email-verification enable-smtp enable-prepl-server disable-secure-session-cookies enable-registration enable-plugins enable-access-tokens";

# parse_yaml keeps a value's own quotes, so `version: "2.16"` reaches the shell as the
# five-character string `"2.16"` — which lands in an image tag as `penpotapp/frontend:"2.16"`
# and, worse, makes `secret_key: ""` a NON-empty string, so every `${x:-fallback}` default
# silently stops working. Strip one layer of matching quotes from anything read from settings.
function penpot_setting() {
  local value="$1";
  case "${value}" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value}";
}

# Write .ddev/docker-compose.penpot.yaml for one project.
#
# $1 the project directory, $2 the public URI, $3 PENPOT_FLAGS, $4 the secret key,
# $5 the host port for the mail catcher
function penpot_write_compose() {
  local project_dir="$1" public_uri="$2" flags="$3" secret_key="$4" mail_port="$5";

  mkdir -p "${project_dir}/.ddev" ;

  cat > "${project_dir}/.ddev/docker-compose.penpot.yaml" <<COMPOSEEOF
## Penpot self-hosted, orchestrated by DDEV.
## Written by cmd-penpot-project.sh — re-run that command rather than editing by hand.
## The DDEV web container (nginx) reverse-proxies ${public_uri} -> penpot-frontend:8080.
## Every service is on the DDEV project's 'default' network, so they resolve each other by name.

volumes:
  penpot_postgres_v15:
  penpot_assets:

services:
  penpot-frontend:
    container_name: ddev-\${DDEV_SITENAME}-penpot-frontend
    image: "penpotapp/frontend:\${PENPOT_VERSION:-${PENPOT_VERSION}}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    volumes:
      - penpot_assets:/opt/data/assets
    depends_on:
      - penpot-backend
      - penpot-exporter
    environment:
      PENPOT_FLAGS: ${flags}
      PENPOT_PUBLIC_URI: ${public_uri}
      PENPOT_HTTP_SERVER_MAX_BODY_SIZE: "367001600"
      PENPOT_HTTP_SERVER_MAX_MULTIPART_BODY_SIZE: "367001600"

  penpot-backend:
    container_name: ddev-\${DDEV_SITENAME}-penpot-backend
    image: "penpotapp/backend:\${PENPOT_VERSION:-${PENPOT_VERSION}}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    volumes:
      - penpot_assets:/opt/data/assets
    depends_on:
      penpot-postgres:
        condition: service_healthy
      penpot-valkey:
        condition: service_healthy
    environment:
      PENPOT_FLAGS: ${flags}
      PENPOT_PUBLIC_URI: ${public_uri}
      PENPOT_SECRET_KEY: ${secret_key}
      PENPOT_HTTP_SERVER_MAX_BODY_SIZE: "367001600"
      PENPOT_HTTP_SERVER_MAX_MULTIPART_BODY_SIZE: "367001600"
      PENPOT_DATABASE_URI: postgresql://penpot-postgres/penpot
      PENPOT_DATABASE_USERNAME: penpot
      PENPOT_DATABASE_PASSWORD: penpot
      PENPOT_REDIS_URI: redis://penpot-valkey/0
      PENPOT_OBJECTS_STORAGE_BACKEND: fs
      PENPOT_OBJECTS_STORAGE_FS_DIRECTORY: /opt/data/assets
      PENPOT_TELEMETRY_ENABLED: "false"
      PENPOT_SMTP_DEFAULT_FROM: no-reply@example.com
      PENPOT_SMTP_DEFAULT_REPLY_TO: no-reply@example.com
      PENPOT_SMTP_HOST: penpot-mailcatch
      PENPOT_SMTP_PORT: "1025"
      PENPOT_SMTP_TLS: "false"
      PENPOT_SMTP_SSL: "false"

  penpot-exporter:
    container_name: ddev-\${DDEV_SITENAME}-penpot-exporter
    image: "penpotapp/exporter:\${PENPOT_VERSION:-${PENPOT_VERSION}}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    depends_on:
      penpot-valkey:
        condition: service_healthy
    environment:
      PENPOT_SECRET_KEY: ${secret_key}
      ## The exporter talks to the frontend container directly, inside the network.
      PENPOT_PUBLIC_URI: http://penpot-frontend:8080
      PENPOT_REDIS_URI: redis://penpot-valkey/0

  penpot-postgres:
    container_name: ddev-\${DDEV_SITENAME}-penpot-postgres
    image: "postgres:15"
    restart: "no"
    stop_signal: SIGINT
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U penpot"]
      interval: 2s
      timeout: 10s
      retries: 5
      start_period: 2s
    volumes:
      - penpot_postgres_v15:/var/lib/postgresql/data
    environment:
      POSTGRES_INITDB_ARGS: "--data-checksums"
      POSTGRES_DB: penpot
      POSTGRES_USER: penpot
      POSTGRES_PASSWORD: penpot

  penpot-valkey:
    container_name: ddev-\${DDEV_SITENAME}-penpot-valkey
    image: "valkey/valkey:8.1"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    healthcheck:
      test: ["CMD-SHELL", "valkey-cli ping | grep PONG"]
      interval: 1s
      timeout: 3s
      retries: 5
      start_period: 3s

  penpot-mailcatch:
    container_name: ddev-\${DDEV_SITENAME}-penpot-mailcatch
    image: "sj26/mailcatcher:latest"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    environment:
      - VIRTUAL_HOST=\$DDEV_HOSTNAME
      - HTTP_EXPOSE=${mail_port}:1080
      - HTTPS_EXPOSE=$((mail_port + 363)):1080
COMPOSEEOF
}

# Write the nginx site config that turns the DDEV web container into the reverse
# proxy. A full replacement (nginx_full), because none of the default PHP site
# config applies to a project that serves no files.
function penpot_write_nginx() {
  local project_dir="$1";

  mkdir -p "${project_dir}/.ddev/nginx_full" ;

  cat > "${project_dir}/.ddev/nginx_full/nginx-site.conf" <<'NGINXEOF'
# DDEV web container nginx: reverse-proxy everything to the Penpot frontend container.
# Full replacement of the default site config (nginx_full).
# Written by cmd-penpot-project.sh — re-run that command rather than editing by hand.

server {
    listen 80 default_server;
    listen 443 ssl default_server;

    root /var/www/html;

    ssl_certificate /etc/ssl/certs/master.crt;
    ssl_certificate_key /etc/ssl/certs/master.key;

    include /etc/nginx/monitoring.conf;

    # Penpot handles large asset/media uploads.
    client_max_body_size 400M;

    # Real IP from the DDEV router.
    include /etc/nginx/common.d/*.conf;

    # The Penpot MCP server runs INSIDE this project's web container network namespace
    # (cmd-penpot-mcp.sh starts it with --network container:), so its three ports are on this
    # container's loopback and are proxied onto the instance's own https origin. That is the only
    # arrangement that works here: the servers bind 127.0.0.1 (so no container can reach them
    # across the network), the editor page is https (so an http://localhost manifest is mixed
    # content and Penpot refuses it: "The plugin doesn't exist or the URL is not correct"), and
    # this machine's firewall drops container-to-host traffic (so a socat relay on the host is
    # unreachable too). Same origin, https and wss, nothing published on the host.
    #
    # The upstreams are [::1], not 127.0.0.1: these servers bind IPv6 loopback ONLY, so an IPv4
    # upstream is refused and nginx answers 502 while the servers are plainly running and logging.
    location /mcp-plugin/ {
        proxy_pass http://[::1]:4400/;
        proxy_http_version 1.1;
        # Vite's preview server refuses an unknown Host with 403 ("This host is not allowed"), so
        # the upstream keeps its own name and the browser-facing origin stays this instance.
        proxy_set_header Host localhost:4400;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /mcp-bridge {
        proxy_pass http://[::1]:4402;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location /mcp {
        proxy_pass http://[::1]:4401;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://penpot-frontend:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        # WebSocket support (Penpot's live notifications).
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

# Register the first account over Penpot's RPC API, so the instance is usable without a
# browser detour. Two calls: prepare-register-profile returns a signed token (it takes the
# full name too — leaving it out fails validation there, not at the second step), then
# register-profile creates the profile and its default project.
#
# An existing email is not a failure: `email-already-exists` is what a rebuild that kept its
# volumes reports, and the account it names is the one you already use.
#
# $1 base url, $2 fullname, $3 email, $4 password
function penpot_register_first_account() {
  local base_url="$1" fullname="$2" email="$3" password="$4";
  local prepared token registered;

  # The backend answers before it is ready to register, so wait for the API itself.
  local waited=0;
  until curl -sk -o /dev/null --max-time 5 "${base_url}/api/rpc/command/get-profile" -X POST -H 'Accept: application/json' -d '{}' ; do
    sleep 3 ; waited=$((waited + 3));
    if [ "${waited}" -ge 120 ] ; then
      echo "The Penpot API did not answer within 2 minutes — register in the browser instead.";
      return 1 ;
    fi
  done

  prepared=$(curl -sk -X POST "${base_url}/api/rpc/command/prepare-register-profile" \
    -H 'Accept: application/json' -H 'Content-Type: application/json' -H "Origin: ${base_url}" \
    --data-binary @- <<JSONEOF
{"email": "${email}", "password": "${password}", "fullname": "${fullname}"}
JSONEOF
  );

  if printf '%s' "${prepared}" | grep -q 'email-already-exists' ; then
    echo "${email} is already registered on this instance — keeping it.";
    return 0 ;
  fi

  token=$(printf '%s' "${prepared}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p');
  if [ -z "${token}" ] ; then
    echo "Could not prepare the registration:";
    printf '  %s\n' "${prepared}";
    return 1 ;
  fi

  registered=$(curl -sk -X POST "${base_url}/api/rpc/command/register-profile" \
    -H 'Accept: application/json' -H 'Content-Type: application/json' -H "Origin: ${base_url}" \
    --data-binary @- <<JSONEOF
{"token": "${token}", "fullname": "${fullname}", "acceptTermsAndPrivacy": true, "acceptNewsletterSubscription": false}
JSONEOF
  );

  if printf '%s' "${registered}" | grep -q '"isActive":true' ; then
    echo "Registered ${fullname} <${email}> and its default project.";
    return 0 ;
  fi

  echo "Registration did not complete:";
  printf '  %s\n' "${registered}";
  return 1 ;
}

# The next free host port from $1 upwards, as seen by docker. Several Penpot instances is the
# normal case — one per design system — and each mail catcher is published on the host, so a
# fixed 1080 would make the second instance fail to start with "port is already in use".
# The pair 1080/1443 keeps its shape: the HTTPS port is always the HTTP one plus 363.
function penpot_free_mail_port() {
  local port="$1" taken;
  taken="$(docker ps --format '{{.Ports}}' 2>/dev/null)";
  while printf '%s' "${taken}" | grep -q ":${port}->" || printf '%s' "${taken}" | grep -q ":$((port + 363))->" ; do
    port=$((port + 1));
    if [ "${port}" -gt 1179 ] ; then
      echo "1080" ; return 0 ;      # give up scanning and let ddev report the conflict
    fi
  done
  printf '%s' "${port}";
}

# Build (or rebuild) a Penpot instance in the calling workspace folder.
#
# The calling cmd-*.sh sets nothing but the workspace: everything else comes from
# the arguments in args/arg-penpot.sh.
function build_penpot() {

  # The workspace settings hold the defaults; an argument that was actually given wins. The
  # sentinel is what tells the two apart — argparse cannot report "not given" on its own.
  if [ "${PROJECT_NAME}" == '_settings_' ] ; then PROJECT_NAME="$(penpot_setting "${penpot_project}")"; PROJECT_NAME="${PROJECT_NAME:-penpot}"; fi
  if [ "${PENPOT_VERSION}" == '_settings_' ] ; then PENPOT_VERSION="$(penpot_setting "${penpot_version}")"; PENPOT_VERSION="${PENPOT_VERSION:-2.16}"; fi
  if [ "${FLAGS}" == '_settings_' ] ; then FLAGS="$(penpot_setting "${penpot_flags}")"; FLAGS="${FLAGS:-${PENPOT_DEFAULT_FLAGS}}"; fi
  if [ "${SECRET_KEY}" == '_settings_' ] ; then SECRET_KEY="$(penpot_setting "${penpot_secret_key}")"; fi
  # The account falls back to the same `account:` block the Drupal installs use, so a machine
  # states its developer identity once.
  if [ "${FULLNAME}" == '_settings_' ] ; then FULLNAME="$(penpot_setting "${penpot_account_fullname}")"; FULLNAME="${FULLNAME:-$(penpot_setting "${account_name}")}"; fi
  if [ "${EMAIL}" == '_settings_' ] ; then EMAIL="$(penpot_setting "${penpot_account_email}")"; EMAIL="${EMAIL:-$(penpot_setting "${account_mail}")}"; fi
  if [ "${PASSWORD}" == '_settings_' ] ; then PASSWORD="$(penpot_setting "${penpot_account_password}")"; PASSWORD="${PASSWORD:-$(penpot_setting "${account_pass}")}"; fi

  local base_url="https://${PROJECT_NAME}.ddev.site";
  local hub_url="https://${PROJECT_NAME}.${doc_name}.workspace.ddev.site";
  local project_dir="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  local flags secret_key mail_port public_uri other_url;

  flags="${FLAGS}";

  # A per-project key, not a literal shared by every instance the tooling builds:
  # the session cookies of one instance must not be forgeable from another's
  # committed config. Derived, so a rebuild of the same project keeps its
  # sessions valid.
  secret_key="${SECRET_KEY}";
  if [ -z "${secret_key}" ] ; then
    secret_key="$(printf 'penpot-%s-%s' "${PROJECT_NAME}" "$(hostname)" | sha256sum | cut -c1-48)";
  fi

  # Penpot's frontend fetches its API from PENPOT_PUBLIC_URI, so the instance works on exactly
  # ONE origin: opened on any other host the API calls are cross-origin and CORS blocks every
  # one of them, which shows up as a blank page rather than an error. The hub hostname is the
  # default because that is the address the workspace hands out — one Penpot per design system,
  # penpot-educare.designs… beside penpot-horizonaid.designs… — and the canonical
  # <project>.ddev.site stays useful for the RPC API, where there is no browser to enforce CORS.
  public_uri="${PUBLIC_URI}";
  if [ "${public_uri}" == '_settings_' ] ; then
    public_uri="$(penpot_setting "${penpot_public_uri}")";
    public_uri="${public_uri:-hub}";
  fi
  case "${public_uri}" in
    hub)       public_uri="${hub_url}";  other_url="${base_url}" ;;
    canonical) public_uri="${base_url}"; other_url="${hub_url}" ;;
    *)         other_url="" ;;
  esac

  mail_port="${MAIL_PORT}";
  if [ "${mail_port}" == '_settings_' ] ; then
    mail_port="$(penpot_setting "${penpot_mail_port}")";
    mail_port="${mail_port:-1080}";
  fi
  mail_port="$(penpot_free_mail_port "${mail_port}")";

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  if [ -d "${PROJECT_NAME}" ] ; then
    if [ "${FORCE}" != 'yes' ] ; then
      echo "";
      echo "${PROJECT_NAME} already exists in ${WORKSPACE_ROOT}/${doc_name}.";
      echo "  Start it with:   cd ${project_dir} && ddev start";
      echo "  Rebuild it with: bash cmd-penpot-project.sh ${PROJECT_NAME} --force";
      echo "  (--force deletes the Penpot volumes too, so the designs in it go with them.)";
      exit 1 ;
    fi
    echo "Removing the existing ${PROJECT_NAME} instance, its database and its assets.";
    # -O removes the project's volumes, which for this project means the Penpot
    # Postgres data and the uploaded assets: the designs are IN there.
    (cd "${project_dir}" && ddev delete -y -O) ;
    rm -rf "${project_dir}" ;
  fi

  mkdir -p "${project_dir}" ;
  cd "${project_dir}" || exit 1 ;

  # No docroot and no settings management: this project serves no files of its
  # own, it only proxies.
  ddev config --project-name=${PROJECT_NAME} --project-type=php --docroot="" --disable-settings-management ;

  penpot_write_compose "${project_dir}" "${public_uri}" "${flags}" "${secret_key}" "${mail_port}" ;
  penpot_write_nginx "${project_dir}" ;

  echo "";
  echo "Starting Penpot ${PENPOT_VERSION} — the first run pulls the images, which takes a few minutes.";
  ddev start -y ;

  if [ "${NO_REGISTER}" == 'yes' ] ; then
    echo "";
    echo "Skipping registration — register the first account at ${base_url}/#/auth/register.";
  else
    echo "";
    echo "Registering the first account.";
    penpot_register_first_account "${public_uri}" "${FULLNAME}" "${EMAIL}" "${PASSWORD}" ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Penpot ${PENPOT_VERSION} is ready — open it here:";
  echo "    ${public_uri}";
  if [ -n "${other_url}" ] ; then
    echo "";
    echo "  ${other_url} reaches the same instance for the RPC API, but NOT in a browser:";
    echo "  Penpot serves one origin, and from the other one CORS blocks every API call.";
  fi
  echo "";
  if [ "${NO_REGISTER}" == 'yes' ] ; then
    echo "  Register the first account (it logs you straight in, no email step):";
    echo "    ${public_uri}/#/auth/register";
  else
    echo "  Log in at ${public_uri}/#/auth/login";
    echo "    ${EMAIL}";
  fi
  echo "";
  echo "  Mail sent by this instance is caught, not delivered:";
  echo "    https://${PROJECT_NAME}.ddev.site:$((mail_port + 363))";
  echo "";
  echo "  Flags: ${flags}";
  echo "  Design agents: enable-plugins is on, so Ctrl+Alt+P loads the Penpot MCP plugin.";
  echo "  Drupal AI Penpot: enable-access-tokens is on, so an access token authenticates.";
  echo "  The full integration walkthrough is in products/ai_penpot/docs/penpot-on-ddev.md.";
  echo "*---------------------------------------------------------------------*";

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi
}

# ---------------------------------------------------------------------------
# Per-instance tools. Each resolves its defaults from the workspace settings
# (`penpot:` in workspace.designs.settings.yml), so the commands take a project
# name and nothing else in the normal case.
# ---------------------------------------------------------------------------

# The project a tool acts on: the argument, else penpot.project from the settings.
function penpot_resolve_project() {
  local given="$1" name;
  if [ -n "${given}" ] && [ "${given}" != '_settings_' ] ; then
    printf '%s' "${given}" ; return 0 ;
  fi
  name="$(penpot_setting "${penpot_project}")";
  printf '%s' "${name:-penpot}";
}

# The one origin an instance serves, resolved the same way build_penpot resolves it — a tool
# that talked to the other host would be CORS-blocked in a browser and inconsistent here.
function penpot_resolve_url() {
  local project="$1" setting;
  setting="$(penpot_setting "${penpot_public_uri}")";
  case "${setting:-hub}" in
    hub)       printf 'https://%s.%s.workspace.ddev.site' "${project}" "${doc_name}" ;;
    canonical) printf 'https://%s.ddev.site' "${project}" ;;
    *)         printf '%s' "${setting}" ;;
  esac
}

# Refuse politely rather than erroring deep inside docker.
function penpot_require_running() {
  local project="$1";
  if ! docker ps --format '{{.Names}}' | grep -qx "ddev-${project}-penpot-backend" ; then
    echo "Penpot ${project} is not running.";
    echo "  Start it:  cd ${WORKSPACE_ROOT}/${doc_name}/${project} && ddev start";
    return 1 ;
  fi
  return 0 ;
}

# Back up one instance: the Postgres database AND the asset volume. Either alone is useless —
# a design is rows in the database plus the files those rows point at.
function penpot_backup() {
  local project stamp out db_file assets_file;
  project="$(penpot_resolve_project "${PROJECT_NAME}")";
  penpot_require_running "${project}" || return 1 ;

  stamp="$(date +%Y-%m-%d-%H%M%S)";
  out="${backups}/${doc_name}/${project}";
  mkdir -p "${out}" ;
  db_file="${out}/${project}-penpot-db-${stamp}.sql.gz";
  assets_file="${out}/${project}-penpot-assets-${stamp}.tar.gz";

  echo "Dumping the Penpot database of ${project}.";
  if ! docker exec "ddev-${project}-penpot-postgres" pg_dump -U penpot penpot | gzip > "${db_file}" ; then
    echo "The database dump failed — removing the partial file.";
    rm -f "${db_file}" ;
    return 1 ;
  fi

  echo "Archiving the Penpot assets of ${project}.";
  # The assets live in a named volume, not in the project directory, so they are read through a
  # throwaway container rather than from the host.
  # --user, or the archive lands owned by root: a backup the user cannot delete is a bad backup.
  if ! docker run --rm --user "$(id -u):$(id -g)" \
       -v "ddev-${project}_penpot_assets:/assets:ro" -v "${out}:/out" \
       busybox tar czf "/out/$(basename "${assets_file}")" -C /assets . ; then
    echo "The asset archive failed — removing the partial file.";
    rm -f "${assets_file}" ;
    return 1 ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Backed up ${project}:";
  echo "    ${db_file}";
  echo "    ${assets_file}";
  echo "  Restore the database with:";
  echo "    gunzip -c <dump> | docker exec -i ddev-${project}-penpot-postgres psql -U penpot penpot";
  echo "*---------------------------------------------------------------------*";
}

# Create a Penpot access token — what the Drupal AI Penpot module authenticates with.
#
# The token is printed ONCE and nowhere else: it is a credential, so it is not written to a
# file, not echoed into a command line, and not left in the backups folder.
function penpot_token() {
  local project url jar name fullname email password prepared token;
  project="$(penpot_resolve_project "${PROJECT_NAME}")";
  penpot_require_running "${project}" || return 1 ;
  url="$(penpot_resolve_url "${project}")";

  email="${EMAIL}";
  if [ "${email}" == '_settings_' ] ; then
    email="$(penpot_setting "${penpot_account_email}")";
    email="${email:-$(penpot_setting "${account_mail}")}";
  fi
  password="${PASSWORD}";
  if [ "${password}" == '_settings_' ] ; then
    password="$(penpot_setting "${penpot_account_password}")";
    password="${password:-$(penpot_setting "${account_pass}")}";
  fi
  name="${TOKEN_NAME}";

  jar="$(mktemp)";
  if ! curl -sk -c "${jar}" -X POST "${url}/api/rpc/command/login-with-password" \
       -H 'Accept: application/json' -H 'Content-Type: application/json' -H "Origin: ${url}" \
       --data-binary @- >/dev/null <<JSONEOF
{"email": "${email}", "password": "${password}"}
JSONEOF
  then
    rm -f "${jar}" ;
    echo "Could not log in to ${url} as ${email}.";
    return 1 ;
  fi

  prepared=$(curl -sk -b "${jar}" -X POST "${url}/api/rpc/command/create-access-token" \
    -H 'Accept: application/json' -H 'Content-Type: application/json' -H "Origin: ${url}" \
    --data-binary @- <<JSONEOF
{"name": "${name}"}
JSONEOF
  );
  rm -f "${jar}" ;

  token=$(printf '%s' "${prepared}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p');
  if [ -z "${token}" ] ; then
    echo "Could not create the access token:";
    printf '  %s\n' "${prepared}";
    return 1 ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Access token \"${name}\" for ${email} on ${url}";
  echo "";
  echo "  ${token}";
  echo "";
  echo "  Shown once and stored nowhere. Paste it into the Drupal site's penpot Key at";
  echo "  /admin/config/system/keys, with the instance URL ${url}.";
  echo "  It needs enable-access-tokens in PENPOT_FLAGS, which this workspace sets by default —";
  echo "  without that flag a token is ignored silently rather than refused.";
  echo "*---------------------------------------------------------------------*";
}

# The Penpot MCP server: a node:22 container on the host network, plus the one-line Claude Code
# registration. Two processes are needed for the MCP to reach a design and only one of them is
# here: the other is a browser tab holding the plugin open, which no script can do for you.
function penpot_mcp() {
  local project url package image port plugin_port bridge_port work container public_host;
  project="$(penpot_resolve_project "${PROJECT_NAME}")";
  url="$(penpot_resolve_url "${project}")";
  package="$(penpot_setting "${penpot_mcp_package}")"; package="${package:-@penpot/mcp@stable}";
  image="$(penpot_setting "${penpot_mcp_image}")";     image="${image:-node:22}";
  port="$(penpot_setting "${penpot_mcp_port}")";               port="${port:-4401}";
  plugin_port="$(penpot_setting "${penpot_mcp_plugin_port}")"; plugin_port="${plugin_port:-4400}";
  bridge_port="$(penpot_setting "${penpot_mcp_bridge_port}")"; bridge_port="${bridge_port:-4402}";
  container="penpot-mcp-${project}";
  public_host="$(printf '%s' "$(penpot_resolve_url "${project}")" | sed 's#^https\?://##')";
  work="${WORKSPACE_ROOT}/${doc_name}/${project}/.penpot-mcp";

  case "${MCP_ACTION}" in
    status)
      if docker ps --format '{{.Names}}' | grep -qx "${container}" ; then
        echo "${container} is running.";
        curl -sk -o /dev/null -w "  MCP endpoint ${url}/mcp → HTTP %{http_code} (406 on a plain GET is correct)\n" "${url}/mcp" ;
        curl -sk -o /dev/null -w "  plugin manifest ${url}/mcp-plugin/manifest.json → HTTP %{http_code}\n" "${url}/mcp-plugin/manifest.json" ;
      else
        echo "${container} is not running. Start it with --start.";
      fi
      claude mcp list 2>/dev/null | grep -i penpot || echo "  Not registered in Claude Code yet — run with --register.";
      ;;
    stop)
      docker rm -f "${container}" >/dev/null 2>&1 && echo "Stopped ${container}." || echo "${container} was not running.";
      ;;
    register)
      claude mcp add --scope user --transport http "penpot-${project}" "${url}/mcp" \
        && echo "Registered penpot-${project} in Claude Code. Open a NEW session to see its tools." ;
      ;;
    start)
      penpot_require_running "${project}" || return 1 ;
      mkdir -p "${work}" ;
      cd "${work}" || return 1 ;
      if [ ! -d package ] ; then
        echo "Fetching ${package}.";
        npm pack "${package}" >/dev/null || return 1 ;
        tar xzf penpot-mcp-*.tgz || return 1 ;
        # pnpm's supply-chain gate blocks esbuild and sharp from running their install scripts,
        # and @penpot/mcp cannot build without them. pnpm 11 has moved the answer from
        # `onlyBuiltDependencies` to `allowBuilds` — given only the old key it writes an
        # `allowBuilds:` stub reading "set this to true or false" and fails with
        # ERR_PNPM_IGNORED_BUILDS anyway. Both keys go in, so either version is satisfied.
        cat >> package/pnpm-workspace.yaml <<'YAMLEOF'

onlyBuiltDependencies:
  - esbuild
  - sharp

allowBuilds:
  esbuild: true
  sharp: true
YAMLEOF
      fi
      docker rm -f "${container}" >/dev/null 2>&1 ;
      # pnpm comes from a /tmp prefix rather than corepack: `corepack enable` symlinks into
      # /usr/local/bin, which a non-root container user cannot write (EACCES on pnpm.js).
      # As the host user, or the install writes a node_modules tree the user cannot delete —
      # `rm -rf` on the work directory then fails with Permission denied on every binary. pnpm and
      # corepack need a writable HOME, which /tmp gives them inside the container.
      # The web container's network namespace, NOT the host's: the MCP servers bind 127.0.0.1, and
      # sharing the namespace is what lets this instance's nginx proxy them onto its https origin.
      # It also means the container has to be started AFTER the project and restarted with it — a
      # `ddev restart` destroys the namespace and leaves the routes answering 502.
      docker run -d --name "${container}" --network "container:ddev-${project}-web" \
        --user "$(id -u):$(id -g)" -e HOME=/tmp \
        -e CI=false -e "PENPOT_MCP_WEBSOCKET_URL=wss://${public_host}/mcp-bridge" \
        -v "${work}/package:/pkg" -w /pkg "${image}" \
        sh -c 'set -e; export PATH=/tmp/npm-global/bin:$PATH; \
               npm install -g --prefix /tmp/npm-global pnpm@11.13.0 >/dev/null; \
               pnpm rebuild esbuild sharp; pnpm -r run build; pnpm -r --parallel run start' >/dev/null || return 1 ;
      echo "";
      echo "*---------------------------------------------------------------------*";
      echo "  ${container} is starting — the first build takes a couple of minutes.";
      echo "    docker logs -f ${container}";
      echo "";
      echo "  MCP endpoint     ${url}/mcp";
      echo "  plugin manifest  ${url}/mcp-plugin/manifest.json  (same origin — an http://localhost";
      echo "                   manifest is mixed content on an https editor page and is refused)";
      echo "  WS bridge        wss://${public_host}/mcp-bridge";
      echo "";
      echo "  Then, and this part no script can do:";
      echo "    1. bash cmd-penpot-mcp.sh ${project} -a register";
      echo "    2. In a Penpot editor tab on ${url}: Ctrl+Alt+P, paste the manifest URL,";
      echo "       INSTALL, OPEN, CONNECT MCP SERVER — and leave that tab open. It holds the";
      echo "       bridge; close it and the tools stop reaching the design.";
      echo "*---------------------------------------------------------------------*";
      ;;
    *)
      echo "Pick one of --start, --stop, --status or --register.";
      return 1 ;
      ;;
  esac
}
