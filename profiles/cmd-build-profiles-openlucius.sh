#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build OpenLucius                                  |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/openlucius         |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/openlucius" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/openlucius" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/openlucius" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/openlucius" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/openlucius" ;

ddev config --project-type=drupal --docroot=web --project-name=openlucius --auto ;
ddev start ;

ddev composer create-project lucius-digital/openlucius-project . --stability dev --no-interaction;