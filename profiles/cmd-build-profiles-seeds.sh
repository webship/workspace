#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Seeds                                       |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/seeds              |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/seeds" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/seeds" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/seeds" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/seeds" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/seeds" ;

ddev config --project-type=drupal --docroot=web --project-name=seeds --auto ;
ddev start ;

ddev composer create-project sprintive/seeds-project . --no-interaction;