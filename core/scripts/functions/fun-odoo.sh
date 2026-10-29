#!/usr/bin/env bash

# Odoo Community on DDEV: an example of a non-PHP builder.
#
# DDEV's own database service runs PostgreSQL, so `ddev export-db` and the backup commands work
# as for any other project. Odoo is the official image as a compose service, and the web
# container's nginx proxies the project's https origin to it, the way the Penpot builder does.
# Custom modules go in the project's addons/ folder, mounted at /mnt/extra-addons.

function odoo_write_compose() {
  local project_dir="$1" ;
  mkdir -p "${project_dir}/.ddev" "${project_dir}/addons" ;

  cat > "${project_dir}/.ddev/docker-compose.odoo.yaml" <<COMPOSEEOF
## Odoo, orchestrated by DDEV. Written by the Odoo builder; re-run it rather than editing by hand.
volumes:
  odoo_data:

services:
  odoo:
    container_name: ddev-\${DDEV_SITENAME}-odoo
    image: "odoo:${site_version}"
    restart: "no"
    labels:
      com.ddev.site-name: \${DDEV_SITENAME}
      com.ddev.approot: \${DDEV_APPROOT}
    depends_on:
      - db
    environment:
      HOST: db
      USER: db
      PASSWORD: db
    volumes:
      - odoo_data:/var/lib/odoo
      - ../addons:/mnt/extra-addons
COMPOSEEOF
}

function odoo_write_nginx() {
  local project_dir="$1" ;
  mkdir -p "${project_dir}/.ddev/nginx_full" ;

  cat > "${project_dir}/.ddev/nginx_full/nginx-site.conf" <<'NGINXEOF'
# DDEV web container nginx: everything goes to the Odoo container.
# Written by the Odoo builder; re-run it rather than editing by hand.
server {
    listen 80 default_server;
    listen 443 ssl default_server;
    root /var/www/html;
    ssl_certificate /etc/ssl/certs/master.crt;
    ssl_certificate_key /etc/ssl/certs/master.key;
    include /etc/nginx/monitoring.conf;
    include /etc/nginx/common.d/*.conf;
    client_max_body_size 200M;
    proxy_read_timeout 720s;

    location / {
        proxy_pass http://odoo:8069;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINXEOF
}

# Run the odoo CLI against the project database.
function odoo_cli() {
  ddev exec -s odoo odoo --db_host=db --db_user=db --db_password=db "$@" ;
}

function build_odoo() {
  local base_url="https://${PROJECT_NAME}.ddev.site" ;
  local project_dir="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  drop_database ;
  rm -rf "${PROJECT_NAME}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_dir}" || exit 1 ;

  # No docroot and no settings management: the project serves no files of its own.
  ddev config --project-type=generic --docroot="" --project-name=${PROJECT_NAME} \
    --database=postgres:16 --disable-settings-management || exit 1 ;
  odoo_write_compose "${project_dir}" ;
  odoo_write_nginx "${project_dir}" ;

  echo "Starting Odoo ${site_version}. The first run pulls the image, which takes a few minutes." ;
  ddev_up start -y || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    local demo="--without-demo=all" ;
    [ "${DEMO}" == 'yes' ] && demo="" ;
    echo "Creating the db database with the base module." ;
    odoo_cli -d db -i base ${demo} --stop-after-init || { echo "The Odoo install failed." ; exit 1 ; } ;
    # The first user is admin/admin; give it the workspace account instead.
    printf '%s\n' \
      "u = env.ref('base.user_admin')" \
      "u.write({'login': '${account_name}', 'password': '${account_pass}', 'email': '${account_mail}'})" \
      "env.cr.commit()" \
      | ddev exec -s odoo -- odoo shell --db_host=db --db_user=db --db_password=db -d db --no-http >/dev/null \
      || echo "Could not set the admin account; log in as admin / admin and change it." ;
    ddev restart >/dev/null 2>&1 ;
    echo "${doc_name} ${PROJECT_NAME} has been installed!!!!";
    echo "Go to ${base_url}/web/login and log in as ${account_name}";
  else
    echo "${doc_name} ${PROJECT_NAME} is ready to install!!!!";
    echo "Go to ${base_url}/web/database/manager to create a database";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
