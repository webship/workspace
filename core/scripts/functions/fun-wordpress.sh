#!/usr/bin/env bash

# WordPress on DDEV: an example of a non-Drupal builder.
#
# Two shapes, picked by the builder:
#   wordpress_shape="core"     WordPress itself, downloaded with wp-cli, docroot at the project root.
#   wordpress_shape="bedrock"  roots/bedrock, WordPress managed by Composer, docroot web/.
#
# DDEV writes wp-config-ddev.php for the database, so nothing here writes database settings.

function build_wordpress() {
  local base_url="https://${PROJECT_NAME}.ddev.site" ;
  local docroot="" ;
  [ "${wordpress_shape}" == 'bedrock' ] && docroot="web" ;

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  drop_database ;
  rm -rf "${PROJECT_NAME}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} || exit 1 ;

  local php_version="${PHP_VERSION:-${site_php_version:-}}" ;
  ddev config --project-type=wordpress --docroot="${docroot}" --project-name=${PROJECT_NAME} \
    ${php_version:+--php-version=${php_version}} --auto || exit 1 ;
  ddev_up start -y || exit 1 ;

  if [ "${wordpress_shape}" == 'bedrock' ] ; then
    ddev composer create-project "roots/bedrock:${site_version}" --no-interaction || { echo "composer create-project failed." ; exit 1 ; } ;
    # Bedrock reads its settings from .env; DDEV's database is always db/db/db.
    {
      echo "DB_NAME='db'" ; echo "DB_USER='db'" ; echo "DB_PASSWORD='db'" ; echo "DB_HOST='db'" ;
      echo "WP_ENV='development'" ; echo "WP_HOME='${base_url}'" ; echo 'WP_SITEURL="${WP_HOME}/wp"' ;
      local key ;
      for key in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT ; do
        echo "${key}='$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')'" ;
      done
    } > .env ;
  else
    ddev wp core download --version="${site_version}" || { echo "wp core download failed." ; exit 1 ; } ;
  fi

  if [ "${INSTALL}" == 'yes' ] ; then
    ddev wp core install --url="${base_url}" --title="${doc_name} ${PROJECT_NAME}" \
      --admin_user="${account_name}" --admin_password="${account_pass}" --admin_email="${account_mail}" \
      --skip-email || { echo "wp core install failed." ; exit 1 ; } ;
    echo "${doc_name} ${PROJECT_NAME} has been installed!!!!";
    echo "Go to ${base_url}/wp-admin and log in as ${account_name}";
  else
    echo "${doc_name} ${PROJECT_NAME} is ready to install!!!!";
    echo "Go to ${base_url}";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
