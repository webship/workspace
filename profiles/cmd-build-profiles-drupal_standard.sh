#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Drupal standard                             |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drupal             |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_standard" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_standard" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_standard" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_standard" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_standard" ;

ddev config --project-type=drupal --docroot=web --project-name=drupal_standard --auto ;
ddev start ;

ddev composer create-project drupal/recommended-project . --no-interaction;