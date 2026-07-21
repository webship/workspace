#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Vardoc                                      |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/vardoc             |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/vardoc" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/vardoc" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/vardoc" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/vardoc" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/vardoc" ;

ddev config --project-type=drupal --docroot=web --project-name=vardoc --auto ;
ddev start ;

ddev composer create-project Vardot/vardoc-project . --no-interaction;