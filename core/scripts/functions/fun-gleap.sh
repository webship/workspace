#!/bin/usr/env bash

# Add Gleap.
function add_gleap() {
  echo "Add Gleap";
  mkdir -p ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/modules/custom ;
  cp -r ${assets}/drupal/modules/varbase_gleap ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/modules/custom/
}

# Enable Gleap.
function enable_gleap() {
  # Change directory to the project.
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot} ; 

  echo "Enable Gleap";
  ddev drush pm:enable varbase_gleap
}

# Disable Gleap.
function disable_gleap() {
  # Change directory to the project.
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot} ;

  echo "Disable Gleap";
  ddev drush pm:uninstall varbase_gleap
}
