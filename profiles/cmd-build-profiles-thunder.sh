#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Thunder                                     |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/thunder            |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/thunder" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/thunder" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/thunder" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/thunder" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/thunder" ;

ddev config --project-type=drupal --docroot=web --project-name=thunder --auto ;
ddev start ;

ddev composer create-project thunder/thunder-project . --no-interaction;