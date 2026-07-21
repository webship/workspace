#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Sector                                      |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/sector             |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/sector" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/sector" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/sector" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/sector" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/sector" ;

ddev config --project-type=drupal --docroot=web --project-name=sector --auto ;
ddev start ;

ddev composer create-project sparksinteractive/sector-project . ;