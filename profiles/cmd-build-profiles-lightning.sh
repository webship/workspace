#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Lightning                                   |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/lightning          |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/lightning" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/lightning" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/lightning" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/lightning" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/lightning" ;

ddev config --project-type=drupal --docroot=web --project-name=lightning --auto ;
ddev start ;

ddev composer create-project acquia/lightning-project . --no-interaction;