#!/bin/usr/env bash

function set_default_settings() {
  echo "Add default settings file before starting the install.";

  cp ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/default.settings.php ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/settings.php ;
  echo "\$databases['default']['default'] = [
    'database' => '${full_database_name}',
    'username' => '${database_username}',
    'password' => '${database_password}',
    'host' => '${database_host}',
    'port' => '${database_port}',
    'namespace' => '${database_namespace}',
    'driver' => '${database_driver}',
    'prefix' => '',
    'collation' => '${database_collation}',
  ];" >> ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/settings.php ;

  # Create the config/sync folder.
  mkdir -p ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/config/sync ;
  echo "\$settings['config_sync_directory'] = '${config_sync_directory}';" >> ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/settings.php ;

  build_time=$( date '+%Y-%m-%d %H-%M-%S' );
  echo "// Built time: ${build_time}" >> ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/sites/default/settings.php ;

}
