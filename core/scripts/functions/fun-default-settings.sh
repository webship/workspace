#!/bin/usr/env bash

# DDEV owns the database connection: it generates settings.php and
# settings.ddev.php (db host "db") for drupal-type projects itself. This
# function no longer writes any $databases block — it only makes sure the
# config sync directory is configured and stamps the build time.
function set_default_settings() {
  echo "Ensure DDEV-managed settings plus the config sync directory.";

  local settings_file="${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/settings.php" ;

  # Create the config/sync folder.
  mkdir -p ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/config/sync ;

  if [ -f "${settings_file}" ]; then
    if ! grep -q "config_sync_directory" "${settings_file}" ; then
      echo "\$settings['config_sync_directory'] = '${config_sync_directory}';" >> "${settings_file}" ;
    fi
    build_time=$( date '+%Y-%m-%d %H-%M-%S' );
    echo "// Built time: ${build_time}" >> "${settings_file}" ;
  else
    echo "settings.php not found yet — DDEV will generate it on start/install." ;
  fi
}
