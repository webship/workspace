#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Drupal demo umami                           |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drupal             |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_demo_umami" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_demo_umami" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_demo_umami" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_demo_umami" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drupal_demo_umami" ;

ddev config --project-type=drupal --docroot=web --project-name=drupal_demo_umami --auto ;
ddev start ;

ddev composer create-project drupal/recommended-project . --no-interaction;