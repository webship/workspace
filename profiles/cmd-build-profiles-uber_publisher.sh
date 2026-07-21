#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Uber Publisher                              |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/uber_publisher     |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/uber_publisher" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/uber_publisher" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/uber_publisher" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/uber_publisher" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/uber_publisher" ;

ddev config --project-type=drupal --docroot=web --project-name=uber_publisher --auto ;
ddev start ;

ddev composer create-project Vardot/varbase-project . --no-interaction;